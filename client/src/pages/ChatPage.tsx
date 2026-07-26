import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useNotebook } from '@/features/notebooks/notebook-context';
import { useAddSource } from '@/features/sources/add-source-context';
import { useSources } from '@/features/sources/useSources';
import { SourceViewer, useSourceViewer } from '@/features/sources/viewer/SourceViewer';
import { ChatMessages } from '@/features/chat/ChatMessages';
import { Composer } from '@/features/chat/Composer';
import { SourceScopePicker } from '@/features/chat/SourceScopePicker';
import { useChat } from '@/features/chat/useChat';
import { PlusIcon } from '@/components/icons';
import { Button } from '@/components/ui';

const STARTERS = [
  'Summarise the key points across these sources',
  'What do these sources disagree about?',
  'Pull out the main claims and their evidence',
];

/**
 * The chat for one notebook.
 *
 * Two states, one composer: an empty conversation centres the prompt box on the
 * page, and the first message drops it to the bottom so the thread reads top to
 * bottom above it. Everything asked here is answered from this notebook's
 * sources and nothing else.
 */
export function ChatPage() {
  const { user } = useAuth();
  const notebook = useNotebook();
  const { open: openAddSource } = useAddSource();
  const viewer = useSourceViewer();

  const { data: sources } = useSources(notebook.id, 'all', '');
  const [scope, setScope] = useState<string[]>([]);
  const { messages, isPending, send, stop, reset } = useChat(notebook.id, scope);

  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const started = messages.length > 0;
  const firstName = user?.name.trim().split(/\s+/)[0];
  const hasReadySources = notebook.counts.ready > 0;

  useEffect(() => {
    if (!started) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isPending, started]);

  // Drop any selection pointing at sources that have since been removed, so a
  // stale id cannot silently narrow retrieval down to nothing.
  useEffect(() => {
    if (!sources || scope.length === 0) return;
    const live = new Set(sources.map((source) => source.id));
    const pruned = scope.filter((id) => live.has(id));
    if (pruned.length !== scope.length) setScope(pruned);
  }, [sources, scope]);

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

  // Only worth showing with something to choose between.
  const picker = sources && sources.length > 1 && (
    <div className="mt-3">
      <SourceScopePicker sources={sources} selected={scope} onChange={setScope} />
    </div>
  );

  if (!started) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <p className="mb-2 flex items-center justify-center gap-2 text-sm text-muted">
          <span aria-hidden>{notebook.emoji}</span>
          {notebook.title}
        </p>
        <h1 className="text-center text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          Where should we begin{firstName ? `, ${firstName}` : ''}?
        </h1>

        <div className="mt-8">{composer}</div>
        {picker}

        {hasReadySources ? (
          <>
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
              Answers draw only on{' '}
              <Link
                to={`/notebooks/${notebook.id}/sources`}
                className="font-medium text-neon hover:underline"
              >
                this notebook&rsquo;s sources
              </Link>
              .
            </p>
          </>
        ) : (
          <p className="mt-10 text-center text-xs text-faint">
            This notebook has no indexed sources yet.{' '}
            <button
              type="button"
              onClick={openAddSource}
              className="font-medium text-neon hover:underline"
            >
              Add one
            </button>{' '}
            and every answer will cite it.
          </p>
        )}

        <SourceViewer {...viewer} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        <ChatMessages messages={messages} user={user} onOpenSource={viewer.open} />
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
          {picker}
        </div>
      </div>

      <SourceViewer {...viewer} />
    </div>
  );
}
