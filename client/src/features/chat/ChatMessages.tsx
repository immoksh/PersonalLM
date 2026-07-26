import { useState, type ReactNode } from 'react';
import { SOURCE_KIND_LABELS, type ChatCitation, type PublicUser } from '@personallm/shared';
import { Avatar } from '@/components/Avatar';
import { LinkIcon, SparkIcon } from '@/components/icons';
import { cx } from '@/components/ui';
import { SOURCE_TYPES } from '@/features/sources/sourceTypes';
import type { ChatMessage } from './useChat';

interface ChatMessagesProps {
  messages: ChatMessage[];
  user: PublicUser | null;
}

export function ChatMessages({ messages, user }: ChatMessagesProps) {
  return (
    <div className="space-y-6">
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserTurn key={message.id} message={message} user={user} />
        ) : (
          <AssistantTurn key={message.id} message={message} />
        ),
      )}
    </div>
  );
}

function UserTurn({ message, user }: { message: ChatMessage; user: PublicUser | null }) {
  return (
    <div className="animate-slide-up flex justify-end gap-3">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-surface-2 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-text sm:max-w-[75%]">
        {message.content}
      </div>
      {user && <Avatar user={user} className="mt-0.5 size-8" />}
    </div>
  );
}

function AssistantTurn({ message }: { message: ChatMessage }) {
  const citations = message.citations ?? [];
  // Retrieval runs before the first token, so an empty streaming turn is the
  // wait — show the dots in place of the answer rather than below it.
  if (message.streaming && !message.content) {
    return (
      <div className="flex gap-3">
        <AssistantAvatar />
        <Thinking />
      </div>
    );
  }

  return (
    <div className="animate-slide-up flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 pt-1">
        <div
          className={cx(
            'text-sm leading-relaxed whitespace-pre-wrap',
            message.error ? 'text-danger' : 'text-text',
          )}
          aria-busy={message.streaming}
        >
          <AnswerText text={message.content} citations={citations} messageId={message.id} />
          {message.streaming && <Caret />}
        </div>
        {/* Citations arrive before the answer; hold them back until it lands. */}
        {citations.length > 0 && !message.streaming && (
          <References citations={citations} messageId={message.id} />
        )}
      </div>
    </div>
  );
}

/** DOM id tying an inline marker to the reference it points at. */
const referenceId = (messageId: string, index: number) => `ref-${messageId}-${index}`;

const MARKER = /\[(\d+)\]/g;

/**
 * The answer with its inline `[n]` markers turned into chips that jump to the
 * matching reference. Markers the citation list doesn't cover — a model that
 * numbered past the sources it was given — are left as plain text rather than
 * rendered as a link to nothing.
 *
 * Splitting on complete `[n]` only means a half-streamed `[1` stays literal
 * until its closing bracket arrives.
 */
function AnswerText({
  text,
  citations,
  messageId,
}: {
  text: string;
  citations: ChatCitation[];
  messageId: string;
}) {
  const cited = new Set(citations.map((citation) => citation.index));
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MARKER)) {
    const index = Number(match[1]);
    if (!cited.has(index)) continue;

    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(<Marker key={`${match.index}`} index={index} messageId={messageId} />);
    cursor = match.index + match[0].length;
  }

  if (cursor === 0) return <>{text}</>;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
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

/** Blinking block that trails the text while it is still being written. */
function Caret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-[1px] bg-neon"
    />
  );
}

/** The documents behind an answer, numbered to match its inline [n] markers. */
function References({ citations, messageId }: { citations: ChatCitation[]; messageId: string }) {
  return (
    <section className="mt-4 border-t border-border pt-3">
      <h4 className="text-xs font-medium text-faint">
        {citations.length === 1 ? '1 reference' : `${citations.length} references`}
      </h4>
      <ol className="mt-2 space-y-1">
        {citations.map((citation) => (
          <Reference key={citation.sourceId} citation={citation} messageId={messageId} />
        ))}
      </ol>
    </section>
  );
}

/**
 * One source. Collapsed it is a single line; expanding reveals the passages the
 * answer was actually grounded in, which is what makes a reference checkable.
 */
function Reference({ citation, messageId }: { citation: ChatCitation; messageId: string }) {
  const [open, setOpen] = useState(false);
  const meta = SOURCE_TYPES[citation.kind];

  return (
    <li id={referenceId(messageId, citation.index)} tabIndex={-1} className="scroll-mt-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2"
      >
        <span className="w-4 shrink-0 text-center text-xs font-medium text-faint">
          {citation.index}
        </span>
        <span
          className={cx(
            // The registry icons default to size-5, too big for this row.
            'grid size-6 shrink-0 place-items-center rounded-md [&_svg]:size-3.5',
            meta.accent === 'neon' ? 'bg-neon-soft text-neon' : 'bg-violet-soft text-violet',
          )}
        >
          {meta.icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
          {citation.title}
        </span>
        <span className="shrink-0 text-[0.7rem] text-faint">
          {SOURCE_KIND_LABELS[citation.kind]}
          {citation.passageCount > 1 && ` · ${citation.passageCount} passages`}
        </span>
      </button>

      {open && (
        <div className="mt-1 mb-2 ml-8 space-y-1.5 border-l border-border pl-3">
          {citation.snippets.map((snippet, index) => (
            <p key={index} className="text-xs leading-relaxed text-muted">
              {snippet}
            </p>
          ))}
          {citation.url && (
            <a
              href={citation.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs font-medium text-neon hover:underline"
            >
              <LinkIcon className="size-3.5" />
              Open source
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-1 pt-2.5" role="status" aria-label="Thinking">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1.5 animate-bounce rounded-full bg-faint"
          style={{ animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function AssistantAvatar() {
  return (
    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-neon-soft text-neon">
      <SparkIcon className="size-4" />
    </span>
  );
}
