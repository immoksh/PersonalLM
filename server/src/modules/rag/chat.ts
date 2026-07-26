import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  formatTimestamp,
  SOURCE_KIND_LABELS,
  type ChatCitation,
  type ChatPassage,
  type ChatResponse,
  type ChatStreamEvent,
} from '@personallm/shared';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { retrievableSourceIds } from '../sources/sources.service.js';
import { getChatModel, messageText } from './models.js';
import { retrieveChunks, type RetrievedChunk } from './query.js';

const SNIPPET_LENGTH = 200;

const MAX_PASSAGES = 3;

const NO_RESULTS_ANSWER =
  "I couldn't find anything in this notebook to answer that. Try adding a source or rephrasing.";

const EMPTY_NOTEBOOK_ANSWER =
  'This notebook has no indexed sources yet. Add one and I can answer from it.';

const SYSTEM_PROMPT = `You are a research assistant that answers questions strictly from the user's own sources.

Grounding:
- Use ONLY the numbered sources below. Do not rely on outside knowledge.
- If the answer is not contained in them, say you could not find it in their sources.
- Cite every claim inline as [1], [2], etc., using the number of the source it came from. Place the marker right after the sentence it supports, and use [1][2] when two sources support the same point.
- A source may contain several passages, separated by "…". They all share that source's number.
- Be concise and factual.

Formatting — write Markdown:
- Short paragraphs. **Bold** for the terms that carry the answer.
- A bullet or numbered list when the answer has several parallel parts; prose when it does not.
- A table only when comparing the same dimensions across several things.
- A \`###\` heading only when the answer genuinely splits into sections. Short answers get none.
- Never wrap the whole answer in a code block, and never restate the question before answering it.`;

const selectSource = db.prepare<[string]>('SELECT url, video_id FROM sources WHERE id = ?');

/** A question asked of one notebook, optionally narrowed to some of its sources. */
export interface ChatQuery {
  userId: string;
  notebookId: string;
  question: string;
  sourceIds?: string[];
}

export async function answerQuestion(query: ChatQuery): Promise<ChatResponse> {
  const grounding = await ground(query);
  if (!grounding.prompt) return { answer: grounding.fallback, citations: [] };

  const response = await getChatModel().invoke(grounding.prompt);

  return {
    answer: messageText(response.content),
    citations: grounding.citations,
  };
}

export async function* streamAnswer(
  query: ChatQuery,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const grounding = await ground(query);
  if (!grounding.prompt) {
    yield { type: 'citations', citations: [] };
    yield { type: 'token', text: grounding.fallback };
    yield { type: 'done' };
    return;
  }

  yield { type: 'citations', citations: grounding.citations };

  const stream = await getChatModel().stream(grounding.prompt, { signal });
  for await (const part of stream) {
    const text = messageText(part.content);
    if (text) yield { type: 'token', text };
  }

  yield { type: 'done' };
}

/**
 * Either a prompt grounded in retrieved passages, or the reason there isn't
 * one. The two no-answer cases read differently to the user — an empty
 * notebook is a setup problem, a miss is a phrasing problem — so they are
 * distinguished here rather than collapsed into one message.
 */
interface Grounding {
  prompt: Array<SystemMessage | HumanMessage> | null;
  citations: ChatCitation[];
  fallback: string;
}

async function ground({ userId, notebookId, question, sourceIds }: ChatQuery): Promise<Grounding> {
  if (!env.ragEnabled) {
    throw ApiError.internal('Chat is unavailable: OPENAI_API_KEY is not configured');
  }

  // Resolved from the notebook, so retrieval physically cannot see a source
  // filed anywhere else. Also asserts the caller owns the notebook.
  const scope = retrievableSourceIds(notebookId, userId, sourceIds);
  logger.debug('Answering question', {
    userId,
    notebookId,
    question,
    scope: scope.length,
    narrowed: Boolean(sourceIds?.length),
  });

  if (scope.length === 0) {
    return { prompt: null, citations: [], fallback: EMPTY_NOTEBOOK_ANSWER };
  }

  const { chunks } = await retrieveChunks(userId, question, scope);
  if (chunks.length === 0) {
    return { prompt: null, citations: [], fallback: NO_RESULTS_ANSWER };
  }

  const groups = groupBySource(chunks);
  const context = groups.map(describeSource).join('\n\n');

  return {
    prompt: [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Sources:\n\n${context}\n\nQuestion: ${question}`),
    ],
    citations: groups.map(toCitation),
    fallback: NO_RESULTS_ANSWER,
  };
}

interface SourceGroup {
  index: number;
  chunks: RetrievedChunk[];
}

function groupBySource(chunks: RetrievedChunk[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();

  for (const chunk of chunks) {
    const group = groups.get(chunk.metadata.sourceId);
    if (group) {
      group.chunks.push(chunk);
      continue;
    }
    groups.set(chunk.metadata.sourceId, { index: groups.size + 1, chunks: [chunk] });
  }

  return [...groups.values()];
}

/**
 * Renders one source's passages for the prompt, labelling each with where it
 * came from. The label is for the model's benefit as much as the reader's: told
 * a passage is "p. 12" or "at 4:05", it tends to mention that in the prose,
 * which is exactly the detail that makes an answer checkable.
 */
function describeSource({ index, chunks }: SourceGroup): string {
  const { kind, title } = chunks[0].metadata;
  const passages = chunks
    .map((chunk) => {
      const label = passageLabel(chunk);
      return label ? `(${label}) ${chunk.text.trim()}` : chunk.text.trim();
    })
    .join('\n…\n');
  return `[${index}] ${title} (${SOURCE_KIND_LABELS[kind]})\n${passages}`;
}

function passageLabel(chunk: RetrievedChunk): string | null {
  const { page, startSec } = chunk.metadata;
  if (typeof page === 'number') return `p. ${page}`;
  if (typeof startSec === 'number') return `at ${formatTimestamp(startSec)}`;
  return null;
}

function toCitation({ index, chunks }: SourceGroup): ChatCitation {
  const { sourceId, kind, title } = chunks[0].metadata;
  const row = selectSource.get(sourceId) as
    | { url: string | null; video_id: string | null }
    | undefined;

  const ranked = chunks.slice().sort((a, b) => b.bestScore - a.bestScore);

  return {
    index,
    sourceId,
    kind,
    title,
    url: row?.url ?? null,
    videoId: row?.video_id ?? null,
    passages: ranked.slice(0, MAX_PASSAGES).map(toPassage),
    passageCount: chunks.length,
    score: Math.max(...chunks.map((chunk) => chunk.bestScore)),
  };
}

/**
 * One retrieved chunk as a citable passage.
 *
 * The locator fields fall back to null rather than being omitted: they come
 * from a Qdrant payload, and points written before locators existed simply do
 * not have them. A citation that says "somewhere in this document" is still
 * openable; one carrying `undefined` through to the client is a crash waiting
 * to happen.
 */
function toPassage(chunk: RetrievedChunk): ChatPassage {
  const { chunkIndex, charStart, charEnd, page, startSec, endSec } = chunk.metadata;

  return {
    chunkIndex: chunkIndex ?? 0,
    text: snippet(chunk.text),
    score: chunk.bestScore,
    charStart: charStart ?? 0,
    charEnd: charEnd ?? 0,
    page: page ?? null,
    startSec: startSec ?? null,
    endSec: endSec ?? null,
  };
}

function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= SNIPPET_LENGTH
    ? collapsed
    : `${collapsed.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`;
}
