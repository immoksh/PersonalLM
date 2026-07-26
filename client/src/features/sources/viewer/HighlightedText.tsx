import { useEffect, useRef } from 'react';

interface HighlightedTextProps {
  text: string;
  /** Character range to mark, in the same coordinates the server indexed. */
  charStart: number;
  charEnd: number;
  /** Re-scrolls to the mark when this changes — e.g. a different passage. */
  scrollKey?: string;
}

/**
 * The extracted text with one passage marked and scrolled into view.
 *
 * Slicing by offset rather than searching for the snippet is the whole point:
 * the passage may appear verbatim several times in a document, and a search
 * would highlight the first one instead of the one the answer actually used.
 * The offsets come from the indexed chunk, so they are the right occurrence by
 * construction.
 */
export function HighlightedText({ text, charStart, charEnd, scrollKey }: HighlightedTextProps) {
  const markRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // `center`, so the passage lands mid-pane with its context either side
    // rather than jammed against the top edge.
    markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [scrollKey, charStart]);

  // Clamp before slicing: a stored range can outlive the text it addressed if a
  // re-index shortened the document, and an out-of-bounds mark would silently
  // render nothing.
  const start = Math.max(0, Math.min(charStart, text.length));
  const end = Math.max(start, Math.min(charEnd, text.length));
  const hasRange = end > start;

  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap text-muted">
      {text.slice(0, start)}
      {hasRange && (
        <mark
          ref={markRef}
          className="rounded bg-neon-soft px-0.5 text-text ring-1 ring-neon/40"
          // Announced as the cited region rather than as decoration.
          aria-label="Cited passage"
        >
          {text.slice(start, end)}
        </mark>
      )}
      {text.slice(end)}
    </div>
  );
}
