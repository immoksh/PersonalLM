import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useAddSource } from '@/features/sources/add-source-context';
import { ChatMessages } from '@/features/chat/ChatMessages';
import { Composer } from '@/features/chat/Composer';
import { useChat } from '@/features/chat/useChat';
import { PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui';

const STARTERS = [
  'Summarise everything I saved this week',
  'What do my sources say about pricing?',
  'Turn my latest transcript into notes',
];

/**
 * The landing screen once you are signed in.
 *
 * Two states, one composer: an empty conversation centres the prompt box on the
 * page, and the first message drops it to the bottom so the thread reads top to
 * bottom above it.
 */
export function ChatPage() {
  const { user } = useAuth();
  const { open: openAddSource } = useAddSource();
  const { messages, isPending, send, stop, reset } = useChat();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const started = messages.length > 0;
  const firstName = user?.name.trim().split(/\s+/)[0];

  useEffect(() => {
    if (!started) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isPending, started]);

  const submit = () => {
    void send(draft);
    setDraft('');
  };

  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSubmit={submit}
      onStop={stop}
      onAttach={openAddSource}
      busy={isPending}
      autoFocus
    />
  );

  if (!started) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <h1 className="text-center text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          Where should we begin{firstName ? `, ${firstName}` : ''}?
        </h1>

        <div className="mt-8">{composer}</div>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => setDraft(starter)}
              className="rounded-full border border-border px-3.5 py-1.5 text-sm text-muted transition hover:border-border-strong hover:text-text"
            >
              {starter}
            </button>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-faint">
          Answers draw on the sources in your library.{' '}
          <button
            type="button"
            onClick={openAddSource}
            className="font-medium text-neon hover:underline"
          >
            Add one
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        <ChatMessages messages={messages} user={user} />
        <div ref={bottomRef} className="h-4" />
      </div>

      {/* Sticky rather than fixed: it stays with the content column, so the
          sidebar and the page scrollbar are both left alone. */}
      <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent pt-4">
        <div className="mx-auto w-full max-w-3xl px-4 pb-3 sm:px-6">
          <div className="mb-2 flex justify-center">
            <Button
              variant="secondary"
              onClick={reset}
              // Clearing mid-reply would let the in-flight answer land in the
              // empty thread a moment later.
              disabled={isPending}
              className="rounded-full px-3 py-1 text-xs"
            >
              <PlusIcon className="size-3.5" />
              New chat
            </Button>
          </div>
          {composer}
        </div>
      </div>
    </div>
  );
}
