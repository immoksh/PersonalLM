/**
 * Minimal server-sent events reader.
 *
 * `EventSource` only speaks GET, and the chat question travels in a POST body,
 * so the stream is read off `fetch()` instead and framed here. Only the `data:`
 * field is used — the server sends no ids, event names, or retry hints.
 */
export async function* parseEventStream<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // `stream: true` holds back a multi-byte character split across chunks.
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; whatever trails the last one is
      // an incomplete event, so it stays buffered for the next read.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        const data = dataOf(event);
        if (data) yield JSON.parse(data) as T;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Joins an event's `data:` lines, the way the SSE spec concatenates them. */
function dataOf(event: string): string {
  return event
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).replace(/^ /, ''))
    .join('\n');
}
