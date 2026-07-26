import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { env } from '../../config/env.js';
import { config } from '../../config/rag.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Lazily-constructed OpenAI clients. They are created on first use rather than
 * at import time so the server still boots (and non-RAG routes keep working)
 * when no key is configured.
 */

let embeddings: OpenAIEmbeddings | null = null;
let chatModel: ChatOpenAI | null = null;

function requireKey(): string {
  if (!env.OPENAI_API_KEY) {
    // Surfaced as a 500 with a clear message rather than a cryptic OpenAI 401.
    throw ApiError.internal('OPENAI_API_KEY is not configured — RAG features are disabled');
  }
  return env.OPENAI_API_KEY;
}

export function getEmbeddings(): OpenAIEmbeddings {
  const { embeddingModel, embeddingDimensions } = config.openai;
  embeddings ??= new OpenAIEmbeddings({
    apiKey: requireKey(),
    model: embeddingModel,
    // Ask for exactly the size the collection was created with. Only the v3
    // models take the parameter — older ones reject the request outright.
    ...(embeddingModel.startsWith('text-embedding-3') ? { dimensions: embeddingDimensions } : {}),
  });
  return embeddings;
}

export function getChatModel(): ChatOpenAI {
  chatModel ??= new ChatOpenAI({
    apiKey: requireKey(),
    model: config.openai.chatModel,
    // Low but non-zero: grounded answers with a little natural phrasing.
    temperature: 0.2,
  });
  return chatModel;
}

/** ChatOpenAI content is a string for text replies but typed as string | parts. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? '')))
      .join('');
  }
  return String(content ?? '');
}
