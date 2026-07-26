import type { Document } from '@langchain/core/documents';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { config } from '../../config/rag.js';
import { logger } from '../../utils/logger.js';
import { getChatModel, getEmbeddings, messageText } from './models.js';
import { getVectorStore, type ChunkMetadata } from './vectorStore.js';

export interface QueryVariants {
  original: string;
  rewritten: string;
  stepBack: string;
  hyde: string;
  subQueries: string[];
}

export interface RetrievedChunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  bestScore: number;
  rrfScore: number;
  matchedBy: string[];
}

interface RankedList {
  label: string;
  hits: Array<[Document, number]>;
}

const REWRITE_SYSTEM_PROMPT = (subQueryCount: number) =>
  `You are a query understanding assistant for a retrieval system over a user's personal document library.
Given a user's question, produce query variants that help retrieve relevant passages. Apply three techniques:
1. Step-back prompting -> one broader, higher-level background question whose answer gives useful context.
2. Query rewriting -> fix spelling/grammar and make the question explicit and self-contained, preserving the original intent.
3. Sub-query decomposition -> break the question into exactly ${subQueryCount} focused sub-questions.
Write plain search-friendly questions. Do not answer the question itself.`;

const HYDE_SYSTEM_PROMPT = `Write a concise, factual passage (3-5 sentences) that directly answers the user's question, as if it were an excerpt from a relevant reference document.
Write confidently in a neutral, encyclopedic tone. Do not add disclaimers, caveats, or say you are unsure.`;

const rewriteSchema = z.object({
  stepBack: z
    .string()
    .describe(
      "A broader, higher-level 'step-back' question whose answer gives useful background for the original query.",
    ),
  rewritten: z
    .string()
    .describe(
      'The original query with spelling/grammar fixed, made clear and self-contained. Preserve the original intent.',
    ),
  subQueries: z
    .array(z.string())
    .describe('Focused sub-questions the original query decomposes into.'),
});

export async function rewriteQuery(
  question: string,
): Promise<Pick<QueryVariants, 'stepBack' | 'rewritten' | 'subQueries'>> {
  const { subQueryCount } = config.retrieval;
  const empty = { stepBack: '', rewritten: question, subQueries: [] as string[] };

  try {
    const model = getChatModel().withStructuredOutput(rewriteSchema, { name: 'query_rewriting' });
    logger.debug(`Rewrite system prompt:\n${REWRITE_SYSTEM_PROMPT(subQueryCount)}`);
    const parsed = await model.invoke([
      new SystemMessage(REWRITE_SYSTEM_PROMPT(subQueryCount)),
      new HumanMessage(question),
    ]);

    return {
      stepBack: parsed.stepBack.trim(),
      rewritten: parsed.rewritten.trim() || question,
      subQueries: parsed.subQueries.map((q) => q.trim()).slice(0, subQueryCount),
    };
  } catch (error) {
    logger.warn('Query rewriting failed, falling back to the original question', {
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
}

export async function hydeDocument(question: string): Promise<string> {
  try {
    const response = await getChatModel().invoke([
      new SystemMessage(HYDE_SYSTEM_PROMPT),
      new HumanMessage(question),
    ]);
    return messageText(response.content).trim();
  } catch (error) {
    logger.warn('HyDE generation failed, continuing without it', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Retrieves the passages most relevant to `question` from `sourceIds`.
 *
 * The caller resolves that list from the notebook being asked about (see
 * `retrievableSourceIds`), which is what keeps notebooks isolated: a search
 * cannot reach a source that is not on it. An empty list is a caller bug — it
 * means "search nothing" — so it is refused rather than quietly widened.
 */
export async function retrieveChunks(
  userId: string,
  question: string,
  sourceIds: string[],
): Promise<{ queries: QueryVariants; chunks: RetrievedChunk[] }> {
  if (sourceIds.length === 0) {
    throw new Error('retrieveChunks called with no sources in scope');
  }

  const [{ stepBack, rewritten, subQueries }, hyde] = await Promise.all([
    rewriteQuery(question),
    hydeDocument(question),
  ]);

  const queries: QueryVariants = { original: question, rewritten, stepBack, hyde, subQueries };
  logger.debug('Query variants', { ...queries });

  const labelled = dedupe([
    { label: 'original', text: question },
    { label: 'rewritten', text: rewritten },
    { label: 'stepBack', text: stepBack },
    { label: 'hyde', text: hyde },
    ...subQueries.map((q, i) => ({ label: `subQuery${i + 1}`, text: q })),
  ]);

  const store = await getVectorStore();
  const filter = { must: buildConditions(userId, sourceIds) };
  const vectors = await getEmbeddings().embedDocuments(labelled.map((q) => q.text));
  const hitsPerQuery = await Promise.all(
    vectors.map((vector) =>
      store.similaritySearchVectorWithScore(vector, config.retrieval.topK, filter),
    ),
  );

  const ranked: RankedList[] = labelled.map((q, i) => ({
    label: q.label,
    hits: hitsPerQuery[i] ?? [],
  }));
  const chunks = reciprocalRankFusion(ranked).slice(0, config.retrieval.finalK);

  logger.debug('Multi-query retrieval', {
    variants: labelled.map((q) => q.label),
    fused: chunks.length,
  });

  return { queries, chunks };
}

function reciprocalRankFusion(
  lists: RankedList[],
  k: number = config.retrieval.rrfK,
): RetrievedChunk[] {
  const fused = new Map<string, RetrievedChunk>();

  for (const { label, hits } of lists) {
    hits.forEach(([doc, score], index) => {
      const contribution = 1 / (k + index + 1);
      const metadata = doc.metadata as ChunkMetadata;
      const id = `${metadata.sourceId}:${metadata.chunkIndex}`;
      const existing = fused.get(id);

      if (existing) {
        existing.rrfScore += contribution;
        existing.bestScore = Math.max(existing.bestScore, score);
        existing.matchedBy.push(label);
        return;
      }

      fused.set(id, {
        id,
        text: doc.pageContent,
        metadata,
        bestScore: score,
        rrfScore: contribution,
        matchedBy: [label],
      });
    });
  }

  return [...fused.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

function dedupe(variants: Array<{ label: string; text: string }>): Array<{
  label: string;
  text: string;
}> {
  const seen = new Set<string>();
  const kept: Array<{ label: string; text: string }> = [];

  for (const variant of variants) {
    const text = variant.text.trim();
    const key = text.toLowerCase();
    if (text.length === 0 || seen.has(key)) continue;
    seen.add(key);
    kept.push({ label: variant.label, text });
  }
  return kept;
}

/**
 * The Qdrant filter every search runs under.
 *
 * Scoping is by explicit source id rather than by a `notebookId` on the payload
 * for two reasons: it is exact — the ids come from a fresh SQLite read of the
 * notebook, so a source moved or deleted a moment ago cannot answer — and it
 * keeps working for points indexed before notebooks existed, whose payloads
 * carry no notebook at all. `userId` stays as a second condition so a bug in
 * the id resolution can still never cross accounts.
 */
function buildConditions(userId: string, sourceIds: string[]): Array<Record<string, unknown>> {
  return [
    { key: 'metadata.userId', match: { value: userId } },
    { key: 'metadata.sourceId', match: { any: sourceIds } },
  ];
}
