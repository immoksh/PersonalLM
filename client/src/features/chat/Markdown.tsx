import type { ReactNode } from 'react';
import type { ChatCitation } from '@personallm/shared';

/**
 * Markdown for assistant answers, with inline `[n]` citation markers rendered as
 * chips that jump to their reference.
 *
 * Purpose-built rather than a library for two reasons. The citation markers have
 * to be interleaved with the formatting at the text-node level, which a
 * pluggable renderer makes awkward. And this renders *while the answer streams*:
 * every construct here requires its closing delimiter, so a half-written
 * `**bold` or `[1` stays literal until the rest arrives instead of flickering
 * between styles as the tokens land.
 *
 * Anything it does not recognise is left as written — an unhandled construct
 * should read as the model's own text, never vanish.
 */

/** DOM id tying an inline marker to the reference it points at. */
export const referenceId = (messageId: string, index: number) => `ref-${messageId}-${index}`;

interface MarkdownProps {
  text: string;
  /** Only markers matching one of these become chips. */
  citations: ChatCitation[];
  messageId: string;
  /** Rendered after the final block — the streaming caret. */
  trailing?: ReactNode;
}

export function Markdown({ text, citations, messageId, trailing }: MarkdownProps) {
  const blocks = parseBlocks(text);
  const cited = new Set(citations.map((citation) => citation.index));
  const inline = (value: string) => <Inline text={value} cited={cited} messageId={messageId} />;

  // Nothing has streamed in yet: still render the caret so the turn is not blank.
  if (blocks.length === 0) return <>{trailing}</>;

  return (
    <div className="space-y-3">
      {blocks.map((block, index) =>
        renderBlock(block, index, inline, index === blocks.length - 1 ? trailing : null),
      )}
    </div>
  );
}

/* --- Blocks ------------------------------------------------------------- */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }
  | { kind: 'table'; head: string[]; rows: string[][] };

interface ListItem {
  depth: number;
  ordered: boolean;
  text: string;
}

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.+)$/;
const BULLET = /^(\s*)[-*+]\s+(.+)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.+)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** `|---|:--:|` — the row that makes the pipes above it a table rather than punctuation. */
const isDivider = (line: string) =>
  line.includes('|') && line.includes('-') && /^[\s|:-]+$/.test(line);

const startsBlock = (line: string) =>
  FENCE.test(line) ||
  RULE.test(line) ||
  HEADING.test(line) ||
  BULLET.test(line) ||
  ORDERED.test(line) ||
  QUOTE.test(line);

function parseBlocks(input: string): Block[] {
  const lines = input.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // The closing fence — or, mid-stream, the end of what has arrived.
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
      i += 1;
      continue;
    }

    if (line.includes('|') && isDivider(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')) {
        rows.push(cells(lines[i]!));
        i += 1;
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const bullet = BULLET.exec(lines[i]!);
        const ordered = ORDERED.exec(lines[i]!);

        if (bullet) {
          items.push({ depth: depthOf(bullet[1]!), ordered: false, text: bullet[2]! });
        } else if (ordered) {
          items.push({ depth: depthOf(ordered[1]!), ordered: true, text: ordered[3]! });
        } else if (items.length > 0 && /^\s{2,}\S/.test(lines[i]!)) {
          // An indented, unmarked line is the previous item wrapping.
          items[items.length - 1]!.text += ` ${lines[i]!.trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: items[0]!.ordered, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length) {
        const quote = QUOTE.exec(lines[i]!);
        if (!quote) break;
        body.push(quote[1]!);
        i += 1;
      }
      blocks.push({ kind: 'quote', text: body.join('\n').trim() });
      continue;
    }

    // Everything else is a paragraph, running to a blank line or the next block.
    // The current line is known not to start one, so this always consumes at
    // least it and the loop cannot stall.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !startsBlock(lines[i]!) &&
      !isDivider(lines[i + 1] ?? '')
    ) {
      body.push(lines[i]!);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: body.join('\n') });
  }

  return blocks;
}

/** Two spaces per level, capped — deeper nesting than that reads as noise. */
const depthOf = (indent: string) => Math.min(2, Math.floor(indent.replace(/\t/g, '  ').length / 2));

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

type InlineRenderer = (text: string) => ReactNode;

function renderBlock(
  block: Block,
  key: number,
  inline: InlineRenderer,
  trailing: ReactNode,
): ReactNode {
  switch (block.kind) {
    case 'heading': {
      // Answers are set at `text-sm`, so an h1 at document scale would tower
      // over its own prose. The levels stay distinguishable, just compressed.
      const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3';
      return (
        <Tag
          key={key}
          className={
            block.level <= 2 ? 'text-base font-semibold text-text' : 'text-sm font-semibold text-text'
          }
        >
          {inline(block.text)}
          {trailing}
        </Tag>
      );
    }

    case 'paragraph':
      return (
        // pre-wrap so a single newline inside a paragraph stays a line break —
        // models use them to separate points, not as Markdown soft breaks.
        <p key={key} className="whitespace-pre-wrap">
          {inline(block.text)}
          {trailing}
        </p>
      );

    case 'list':
      return (
        <List key={key} nodes={nest(block.items)} ordered={block.ordered} inline={inline}>
          {trailing}
        </List>
      );

    case 'code':
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-text"
        >
          <code>{block.text}</code>
          {trailing}
        </pre>
      );

    case 'quote':
      return (
        <blockquote
          key={key}
          className="border-l-2 border-neon pl-3 whitespace-pre-wrap text-muted italic"
        >
          {inline(block.text)}
          {trailing}
        </blockquote>
      );

    case 'rule':
      return <hr key={key} className="border-border" />;

    case 'table':
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-border px-2.5 py-1.5 text-left font-medium text-text"
                  >
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className="border-b border-border/60 px-2.5 py-1.5 align-top text-muted"
                    >
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {trailing}
        </div>
      );
  }
}

/* --- Lists -------------------------------------------------------------- */

interface ListNode {
  text: string;
  ordered: boolean;
  children: ListNode[];
}

/**
 * Turns the flat, indentation-tagged items into a tree.
 *
 * `levels[d]` is the sibling array currently open at depth `d`. An item is
 * filed at its own depth — clamped to one past the deepest open level, so a
 * list that jumps straight from top level to double-indented still nests once
 * rather than being dropped.
 */
function nest(items: ListItem[]): ListNode[] {
  const root: ListNode[] = [];
  const levels: ListNode[][] = [root];

  for (const item of items) {
    const depth = Math.min(item.depth, levels.length - 1);
    levels.length = depth + 1;

    const node: ListNode = { text: item.text, ordered: item.ordered, children: [] };
    levels[depth]!.push(node);
    levels.push(node.children);
  }

  return root;
}

function List({
  nodes,
  ordered,
  inline,
  children,
}: {
  nodes: ListNode[];
  ordered: boolean;
  inline: InlineRenderer;
  /** The streaming caret, trailing the last item. */
  children?: ReactNode;
}) {
  const Tag = ordered ? 'ol' : 'ul';

  return (
    <Tag className={ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
      {nodes.map((node, index) => (
        <li key={index} className="pl-0.5 marker:text-faint">
          {inline(node.text)}
          {node.children.length > 0 && (
            <div className="mt-1">
              <List nodes={node.children} ordered={node.children[0]!.ordered} inline={inline} />
            </div>
          )}
          {index === nodes.length - 1 && children}
        </li>
      ))}
    </Tag>
  );
}

/* --- Inline ------------------------------------------------------------- */

/**
 * Ordered alternation: code first so its contents are never re-parsed, `**` before
 * `*` so bold is not read as two italics, and links before citation markers so
 * `[1](url)` is a link rather than a chip followed by stray text.
 *
 * `_underscore_` italics are deliberately unsupported: snake_case identifiers are
 * far more common in these answers than underscore emphasis, and mangling one is
 * worse than not styling the other.
 */
const INLINE =
  /`([^`\n]+)`|\*\*([^\n]+?)\*\*|\*([^*\n]+?)\*|\[([^\]\n]*)\]\(([^)\s]+)\)|\[(\d{1,3})\]/g;

function Inline({
  text,
  cited,
  messageId,
}: {
  text: string;
  cited: Set<number>;
  messageId: string;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE)) {
    const [whole, code, strong, em, label, href, marker] = match;

    // A marker the citation list does not cover — a model that numbered past the
    // sources it was given — stays plain text rather than linking to nothing.
    const index = marker === undefined ? null : Number(marker);
    if (index !== null && !cited.has(index)) continue;

    const url = href === undefined ? null : safeHref(href);
    if (href !== undefined && !url) continue; // Not a link we will follow; leave it as text.

    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    cursor = match.index + whole.length;
    const key = String(match.index);

    if (code !== undefined) {
      parts.push(
        <code key={key} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
          {code}
        </code>,
      );
    } else if (strong !== undefined) {
      parts.push(
        <strong key={key} className="font-semibold text-text">
          <Inline text={strong} cited={cited} messageId={messageId} />
        </strong>,
      );
    } else if (em !== undefined) {
      parts.push(
        <em key={key}>
          <Inline text={em} cited={cited} messageId={messageId} />
        </em>,
      );
    } else if (url) {
      parts.push(
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-neon underline underline-offset-2"
        >
          {label || url}
        </a>,
      );
    } else if (index !== null) {
      parts.push(<Marker key={key} index={index} messageId={messageId} />);
    }
  }

  if (cursor === 0) return <>{text}</>;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/**
 * Only http(s) links are rendered as links. The href comes out of model output,
 * so `javascript:` and `data:` are refused rather than sanitised.
 */
function safeHref(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function Marker({ index, messageId }: { index: number; messageId: string }) {
  return (
    <a
      href={`#${referenceId(messageId, index)}`}
      // The list is a couple of lines below the marker, so scrolling is only
      // for long answers; the focus ring is what actually points it out.
      onClick={(event) => {
        event.preventDefault();
        const target = document.getElementById(referenceId(messageId, index));
        target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        target?.focus({ preventScroll: true });
      }}
      aria-label={`Reference ${index}`}
      className="mx-0.5 inline-flex min-w-4 justify-center rounded bg-neon-soft px-1 align-baseline text-[0.7rem] font-medium text-neon no-underline transition hover:bg-neon hover:text-bg"
    >
      {index}
    </a>
  );
}
