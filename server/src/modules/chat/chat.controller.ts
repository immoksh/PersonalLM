import type { NextFunction, Request, Response } from 'express';
import { chatRequestSchema } from '@personallm/shared';
import type { ApiSuccess, ChatResponse, ChatStreamEvent } from '@personallm/shared';
import { body } from '../../middleware/validate.js';
import { currentUser } from '../../middleware/requireAuth.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { answerQuestion, streamAnswer } from '../rag/chat.js';

export async function ask(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { notebookId, question, sourceIds } = body(req, chatRequestSchema);

  const answer = await answerQuestion({ userId: user.id, notebookId, question, sourceIds });

  const payload: ApiSuccess<ChatResponse> = { data: answer };
  res.json(payload);
}

export async function askStream(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = currentUser(req);
  const { notebookId, question, sourceIds } = body(req, chatRequestSchema);

  const aborter = new AbortController();
  res.on('close', () => aborter.abort());

  const events = streamAnswer(
    { userId: user.id, notebookId, question, sourceIds },
    aborter.signal,
  );
  let first: IteratorResult<ChatStreamEvent>;
  try {
    first = await events.next();
  } catch (error) {
    next(error);
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  try {
    for (let event = first; !event.done; event = await events.next()) {
      if (!send(res, event.value)) break;
    }
  } catch (error) {
    if (aborter.signal.aborted) return;
    const apiError = error instanceof ApiError ? error : null;
    logger.error('Chat stream failed', {
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
    send(res, {
      type: 'error',
      message: apiError?.message ?? 'The answer stopped unexpectedly. Try again.',
      code: apiError?.code ?? 'INTERNAL_ERROR',
    });
  } finally {
    await events.return(undefined);
    res.end();
  }
}

function send(res: Response, event: ChatStreamEvent): boolean {
  if (res.writableEnded) return false;
  return res.write(`data: ${JSON.stringify(event)}\n\n`);
}
