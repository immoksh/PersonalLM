import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { __testing, type QueuedChunk } from './vectorStore.js';

const { normalizeChunk } = __testing;

/**
 * Queue payloads outlive the code that wrote them. These pin the reading side
 * of that contract: a job enqueued by the previous version — chunks as plain
 * strings, before locators existed — has to stay readable, because otherwise it
 * destructures to `undefined` text and fails its whole source with an opaque
 * "input cannot be an empty string" from the embeddings API.
 */
describe('normalizeChunk', () => {
  it('passes a located chunk through unchanged', () => {
    const chunk: QueuedChunk = {
      text: 'already located',
      charStart: 10,
      charEnd: 25,
      page: 3,
      startSec: null,
      endSec: null,
    };

    assert.deepEqual(normalizeChunk(chunk), chunk);
  });

  it('widens a legacy string chunk, keeping its text', () => {
    assert.deepEqual(normalizeChunk('legacy payload'), {
      text: 'legacy payload',
      charStart: 0,
      charEnd: 0,
      page: null,
      startSec: null,
      endSec: null,
    });
  });

  it('reports an empty legacy chunk as empty text rather than undefined', () => {
    // The distinction that matters: callers skip on falsy `text`, so this must
    // not come back as `undefined` and reach the embeddings API as "".
    assert.equal(normalizeChunk('').text, '');
  });
});
