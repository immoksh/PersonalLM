import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatCitation } from '@personallm/shared';
import { api } from '@/lib/api';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Sources the answer was grounded in. Only ever set on assistant turns. */
  citations?: ChatCitation[];
  /** True from the moment the turn is created until its stream ends. */
  streaming?: boolean;
  /** Set when the turn failed, so the bubble can render an error tone. */
  error?: boolean;
}

/**
 * A single in-memory conversation, scoped to one notebook. Nothing is persisted
 * across reloads yet.
 *
 * `sourceIds` optionally narrows retrieval to a subset of the notebook; the
 * server intersects it with the notebook's own sources, so it can only ever
 * shrink the scope, never reach outside.
 */
export function useChat(notebookId: string, sourceIds?: string[]) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPending, setIsPending] = useState(false);
  // A ref as well as the state: the state only reaches the guard on the next
  // render, so two submits in the same tick would both get through.
  const inFlight = useRef(false);
  const aborter = useRef<AbortController | null>(null);

  // Never leave a stream reading into an unmounted component.
  useEffect(() => () => aborter.current?.abort(), []);

  // Read through a ref so `send` stays referentially stable while the selection
  // changes — the composer would otherwise remount its handlers on every toggle.
  const scopeRef = useRef(sourceIds);
  scopeRef.current = sourceIds;

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || inFlight.current) return;

      inFlight.current = true;
      setIsPending(true);

      const replyId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'user', content: question },
        // The reply is added up front so tokens have somewhere to land; while it
        // is still empty the bubble renders as the thinking indicator.
        { id: replyId, role: 'assistant', content: '', streaming: true },
      ]);

      const update = (change: (message: ChatMessage) => Partial<ChatMessage>) =>
        setMessages((current) =>
          current.map((message) =>
            message.id === replyId ? { ...message, ...change(message) } : message,
          ),
        );

      const controller = new AbortController();
      aborter.current = controller;

      const scope = scopeRef.current;

      try {
        // `/api/chat/stream` is single-turn: it retrieves against this question
        // alone, so no history is sent. Follow-ups must restate their subject.
        for await (const event of api.chat.askStream(
          {
            notebookId,
            question,
            // Omitted when nothing is selected, which the server reads as "the
            // whole notebook" rather than "no sources at all".
            ...(scope && scope.length > 0 ? { sourceIds: scope } : {}),
          },
          controller.signal,
        )) {
          switch (event.type) {
            case 'citations':
              update(() => ({ citations: event.citations }));
              break;
            case 'token':
              update((message) => ({ content: message.content + event.text }));
              break;
            case 'error':
              // Keep any partial answer; the failure is appended to it.
              update((message) => ({
                error: !message.content,
                content: message.content ? `${message.content}\n\n${event.message}` : event.message,
              }));
              break;
            case 'done':
              break;
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Something went wrong. Try again.';
        update((current) => ({
          error: !current.content,
          content: current.content ? `${current.content}\n\n${message}` : message,
        }));
      } finally {
        update(() => ({ streaming: false }));
        aborter.current = null;
        inFlight.current = false;
        setIsPending(false);
      }
    },
    [notebookId],
  );

  /** Cuts the current answer short, keeping whatever has streamed in so far. */
  const stop = useCallback(() => {
    aborter.current?.abort();
  }, []);

  const reset = useCallback(() => {
    aborter.current?.abort();
    setMessages([]);
  }, []);

  return { messages, isPending, send, stop, reset };
}
