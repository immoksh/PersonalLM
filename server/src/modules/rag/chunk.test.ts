import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunkDocument } from './chunk.js';
import { buildDocument } from './document.js';

/**
 * The invariant the source viewer rests on: a chunk's `charStart`/`charEnd`
 * index the exact string stored on the source row. If flattening and chunking
 * ever disagree about whitespace, citations silently highlight the wrong words
 * — which looks like a UI bug and is really a pipeline one, so it is pinned
 * here rather than left to be noticed by eye.
 */
const assertOffsetsAlign = (text: string, chunks: ReturnType<typeof chunkDocument>) => {
  for (const chunk of chunks) {
    assert.equal(text.slice(chunk.charStart, chunk.charEnd), chunk.text);
  }
};

describe('buildDocument', () => {
  it('collapses horizontal whitespace but keeps paragraph breaks', () => {
    const { text } = buildDocument({ segments: [{ text: '  a\t\t b \n\n\n\n c  ' }] });
    assert.equal(text, 'a b \n\n c');
  });

  it('records a span per segment, separated by a blank line', () => {
    const { text, spans } = buildDocument({
      segments: [
        { text: 'first page', page: 1 },
        { text: 'second page', page: 2 },
      ],
    });

    assert.equal(text, 'first page\n\nsecond page');
    assert.deepEqual(spans, [
      { page: 1, start: 0, end: 10 },
      { page: 2, start: 12, end: 23 },
    ]);
  });

  it('drops segments that normalise to nothing', () => {
    const { text, spans } = buildDocument({
      segments: [{ text: 'kept', page: 1 }, { text: '   ', page: 2 }, { text: 'also', page: 3 }],
    });

    assert.equal(text, 'kept\n\nalso');
    assert.deepEqual(
      spans.map((span) => span.page),
      [1, 3],
    );
  });
});

describe('chunkDocument', () => {
  it('keeps chunk offsets aligned with the stored text', () => {
    const document = buildDocument({
      segments: Array.from({ length: 12 }, (_, index) => ({
        text: `Page ${index + 1}. ${'lorem ipsum dolor sit amet '.repeat(20)}`,
        page: index + 1,
      })),
    });

    const chunks = chunkDocument(document, 300, 50);

    assert.ok(chunks.length > 1, 'expected the sample to split into several chunks');
    assertOffsetsAlign(document.text, chunks);
  });

  it('holds the offset invariant for a single short segment too', () => {
    const document = buildDocument({ segments: [{ text: '  just one short line  ' }] });
    const chunks = chunkDocument(document, 300, 50);

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.text, 'just one short line');
    assertOffsetsAlign(document.text, chunks);
  });

  it('attributes a chunk to the page it starts on', () => {
    const document = buildDocument({
      segments: [
        { text: 'alpha '.repeat(40), page: 7 },
        { text: 'beta '.repeat(40), page: 8 },
      ],
    });

    const chunks = chunkDocument(document, 120, 20);

    assert.equal(chunks[0]?.page, 7);
    assert.equal(chunks[chunks.length - 1]?.page, 8);
    // Every chunk lands on one of the two pages, never on null.
    assert.ok(chunks.every((chunk) => chunk.page === 7 || chunk.page === 8));
  });

  it('spans a timed chunk from its first cue to its last', () => {
    const document = buildDocument({
      segments: [
        { text: 'we begin here ' + 'talking '.repeat(20), startSec: 10, endSec: 20 },
        { text: 'and we continue ' + 'talking '.repeat(20), startSec: 20, endSec: 31.5 },
      ],
    });

    const [first] = chunkDocument(document, 1000, 100);

    assert.equal(first?.startSec, 10);
    assert.equal(first?.endSec, 31.5);
  });

  it('leaves locators null when the format has no positions', () => {
    const document = buildDocument({ segments: [{ text: 'plain prose with no positions' }] });
    const [chunk] = chunkDocument(document, 300, 50);

    assert.equal(chunk?.page, null);
    assert.equal(chunk?.startSec, null);
    assert.equal(chunk?.endSec, null);
  });
});
