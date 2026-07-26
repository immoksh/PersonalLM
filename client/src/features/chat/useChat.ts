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

/** A single in-memory conversation. Nothing is persisted across reloads yet. */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isPending, setIsPending] = useState(false);
  // A ref as well as the state: the state only reaches the guard on the next
  // render, so two submits in the same tick would both get through.
  const inFlight = useRef(false);
  const aborter = useRef<AbortController | null>(null);

  // Never leave a stream reading into an unmounted component.
  useEffect(() => () => aborter.current?.abort(), []);

  const send = useCallback(async (text: string) => {
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

    try {
      // `/api/chat/stream` is single-turn: it retrieves against this question
      // alone, so no history is sent. Follow-ups must restate their subject.
      for await (const event of api.chat.askStream({ question }, controller.signal)) {
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
      const message = error instanceof Error ? error.message : 'Something went wrong. Try again.';
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
  }, []);

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
