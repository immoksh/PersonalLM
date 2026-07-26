import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  SOURCE_KIND_LABELS,
  type ChatCitation,
  type ChatResponse,
  type ChatStreamEvent,
} from '@personallm/shared';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { getChatModel, messageText } from './models.js';
import { retrieveChunks, type RetrievedChunk } from './query.js';

const SNIPPET_LENGTH = 200;

const MAX_SNIPPETS = 3;

const NO_RESULTS_ANSWER =
  "I couldn't find anything in your sources to answer that. Try adding a source or rephrasing.";

const SYSTEM_PROMPT = `You are a research assistant that answers questions strictly from the user's own sources.

Rules:
- Use ONLY the numbered sources below. Do not rely on outside knowledge.
- If the answer is not contained in them, say you could not find it in their sources.
- Cite every claim inline as [1], [2], etc., using the number of the source it came from. Place the marker right after the sentence it supports, and use [1][2] when two sources support the same point.
- A source may contain several passages, separated by "…". They all share that source's number.
- Be concise and factual.`;

const selectUrl = db.prepare<[string]>('SELECT url FROM sources WHERE id = ?');

export async function answerQuestion(
  userId: string,
  question: string,
  sourceIds?: string[],
): Promise<ChatResponse> {
  const grounding = await ground(userId, question, sourceIds);
  if (!grounding) return { answer: NO_RESULTS_ANSWER, citations: [] };

  const response = await getChatModel().invoke(grounding.prompt);

  return {
    answer: messageText(response.content),
    citations: grounding.citations,
  };
}

export async function* streamAnswer(
  userId: string,
  question: string,
  sourceIds?: string[],
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const grounding = await ground(userId, question, sourceIds);
  if (!grounding) {
    yield { type: 'citations', citations: [] };
    yield { type: 'token', text: NO_RESULTS_ANSWER };
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

async function ground(
  userId: string,
  question: string,
  sourceIds?: string[],
): Promise<{ prompt: Array<SystemMessage | HumanMessage>; citations: ChatCitation[] } | null> {
  if (!env.ragEnabled) {
    throw ApiError.internal('Chat is unavailable: OPENAI_API_KEY is not configured');
  }
  logger.debug('Answering question', {
    userId,
    question,
    sourceIds: sourceIds?.length ? sourceIds : 'all',
  });

  const { chunks } = await retrieveChunks(userId, question, sourceIds);
  if (chunks.length === 0) return null;

  const groups = groupBySource(chunks);
  const context = groups.map(describeSource).join('\n\n');

  return {
    prompt: [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Sources:\n\n${context}\n\nQuestion: ${question}`),
    ],
    citations: groups.map(toCitation),
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

function describeSource({ index, chunks }: SourceGroup): string {
  const { kind, title } = chunks[0].metadata;
  const passages = chunks.map((chunk) => chunk.text.trim()).join('\n…\n');
  return `[${index}] ${title} (${SOURCE_KIND_LABELS[kind]})\n${passages}`;
}

function toCitation({ index, chunks }: SourceGroup): ChatCitation {
  const { sourceId, kind, title } = chunks[0].metadata;
  const row = selectUrl.get(sourceId) as { url: string | null } | undefined;

  return {
    index,
    sourceId,
    kind,
    title,
    url: row?.url ?? null,
    snippets: chunks
      .slice()
      .sort((a, b) => b.bestScore - a.bestScore)
      .slice(0, MAX_SNIPPETS)
      .map((chunk) => snippet(chunk.text)),
    passageCount: chunks.length,
    score: Math.max(...chunks.map((chunk) => chunk.bestScore)),
  };
}

function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= SNIPPET_LENGTH
    ? collapsed
    : `${collapsed.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`;
}
