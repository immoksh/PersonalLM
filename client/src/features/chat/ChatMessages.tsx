import { useState } from 'react';
import {
  formatTimestamp,
  SOURCE_KIND_LABELS,
  type ChatCitation,
  type ChatPassage,
  type PublicUser,
} from '@personallm/shared';
import { Avatar } from '@/components/Avatar';
import { LinkIcon, SparkIcon } from '@/components/icons';
import { cx } from '@/components/ui';
import { SOURCE_TYPES } from '@/features/sources/sourceTypes';
import type { ViewerTarget } from '@/features/sources/viewer/SourceViewer';
import { Markdown, referenceId } from './Markdown';
import type { ChatMessage } from './useChat';

interface ChatMessagesProps {
  messages: ChatMessage[];
  user: PublicUser | null;
  /** Opens the source viewer at a cited passage. */
  onOpenSource: (target: ViewerTarget) => void;
}

export function ChatMessages({ messages, user, onOpenSource }: ChatMessagesProps) {
  return (
    <div className="space-y-6">
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserTurn key={message.id} message={message} user={user} />
        ) : (
          <AssistantTurn key={message.id} message={message} onOpenSource={onOpenSource} />
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

function AssistantTurn({
  message,
  onOpenSource,
}: {
  message: ChatMessage;
  onOpenSource: (target: ViewerTarget) => void;
}) {
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
          className={cx('text-sm leading-relaxed', message.error ? 'text-danger' : 'text-text')}
          aria-busy={message.streaming}
        >
          <Markdown
            text={message.content}
            citations={citations}
            messageId={message.id}
            trailing={message.streaming ? <Caret /> : null}
          />
        </div>
        {/* Citations arrive before the answer; hold them back until it lands. */}
        {citations.length > 0 && !message.streaming && (
          <References
            citations={citations}
            messageId={message.id}
            onOpenSource={onOpenSource}
          />
        )}
      </div>
    </div>
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
function References({
  citations,
  messageId,
  onOpenSource,
}: {
  citations: ChatCitation[];
  messageId: string;
  onOpenSource: (target: ViewerTarget) => void;
}) {
  return (
    <section className="mt-4 border-t border-border pt-3">
      <h4 className="text-xs font-medium text-faint">
        {citations.length === 1 ? '1 reference' : `${citations.length} references`}
      </h4>
      <ol className="mt-2 space-y-1">
        {citations.map((citation) => (
          <Reference
            key={citation.sourceId}
            citation={citation}
            messageId={messageId}
            onOpenSource={onOpenSource}
          />
        ))}
      </ol>
    </section>
  );
}

/**
 * One source behind an answer. Collapsed it is a single line; expanding reveals
 * the individual passages, each of which opens the source viewer at exactly
 * where it came from — the page, the timestamp, or the highlighted characters.
 */
function Reference({
  citation,
  messageId,
  onOpenSource,
}: {
  citation: ChatCitation;
  messageId: string;
  onOpenSource: (target: ViewerTarget) => void;
}) {
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
        <div className="mt-1 mb-2 ml-8 space-y-2 border-l border-border pl-3">
          {citation.passages.map((passage) => (
            <PassageRow
              key={passage.chunkIndex}
              passage={passage}
              onOpen={() =>
                onOpenSource({
                  sourceId: citation.sourceId,
                  passage,
                  quote: passage.text,
                })
              }
            />
          ))}

          {citation.url && (
            <a
              href={citation.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs font-medium text-neon hover:underline"
            >
              <LinkIcon className="size-3.5" />
              Open the original
            </a>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * One quoted passage, as a button that opens it in place.
 *
 * The location label is what tells the reader the citation is real before they
 * even click — "p. 12" is a claim the viewer can then be held to.
 */
function PassageRow({ passage, onOpen }: { passage: ChatPassage; onOpen: () => void }) {
  const location = passageLocation(passage);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/passage block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2"
    >
      <span className="flex items-center gap-1.5">
        {location && (
          <span className="rounded bg-neon-soft px-1.5 py-0.5 text-[0.65rem] font-medium text-neon">
            {location}
          </span>
        )}
        <span className="text-[0.65rem] text-faint opacity-0 transition group-hover/passage:opacity-100">
          Open in source →
        </span>
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted">{passage.text}</span>
    </button>
  );
}

/** "p. 12" / "4:05" / null when the format carries no position. */
function passageLocation(passage: ChatPassage): string | null {
  if (passage.page !== null) return `p. ${passage.page}`;
  if (passage.startSec !== null) return formatTimestamp(passage.startSec);
  return null;
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
