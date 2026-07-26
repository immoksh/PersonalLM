import { NavLink } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useCurrentNotebookId } from '@/features/notebooks/useCurrentNotebookId';
import { useNotebooks } from '@/features/notebooks/useNotebooks';
import { useSources } from '@/features/sources/useSources';
import { SourceStatusDot } from '@/features/sources/SourceStatusDot';
import { ChatIcon, LayersIcon, PlusIcon } from './icons';
import { Button, Spinner, cx } from './ui';

interface SidebarProps {
  onAddSource: () => void;
  /** Lets the mobile drawer close itself once a destination is chosen. */
  onNavigate?: () => void;
}

const navClass = (isActive: boolean) =>
  cx(
    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-neon-soft text-neon' : 'text-muted hover:bg-surface-2 hover:text-text',
  );

export function Sidebar({ onAddSource, onNavigate }: SidebarProps) {
  const { user } = useAuth();
  // From the URL rather than the notebook context: the sidebar is rendered by
  // the layout, above the notebook route, and must still render on /notebooks
  // where no notebook is open at all.
  const notebookId = useCurrentNotebookId();

  // Only a signed-in user has notebooks; skip the request (and its 401) otherwise.
  const { data: notebooks } = useNotebooks({ enabled: Boolean(user) });
  const { data: sources, isPending } = useSources(notebookId ?? '', 'all', '', {
    enabled: Boolean(user && notebookId),
  });

  const addSourceHint = !user
    ? 'Sign in to add sources'
    : !notebookId
      ? 'Open a notebook first — every source belongs to one'
      : undefined;

  return (
    <div className="flex h-full flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid size-9 place-items-center rounded-xl bg-neon text-neon-ink glow">
          <LayersIcon className="size-5" />
        </span>
        <span className="text-lg font-semibold tracking-tight text-gradient">PersonalLM</span>
      </div>

      <div className="px-4 pb-4">
        {/* Disabled rather than hidden when there is nowhere to file a source:
            the button is the main affordance, and hiding it makes the sidebar
            look broken. */}
        <Button
          onClick={onAddSource}
          disabled={Boolean(addSourceHint)}
          title={addSourceHint}
          className="w-full"
        >
          <PlusIcon className="size-4" />
          Add Source
        </Button>
      </div>

      {/* The switcher. Always present, so the isolation boundary is visible
          rather than something the user has to infer. */}
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between px-5 pb-2">
          <span className="text-xs font-semibold tracking-wide text-faint uppercase">Notebooks</span>
          <NavLink
            to="/notebooks"
            onClick={onNavigate}
            className="text-xs font-medium text-faint transition hover:text-text"
          >
            All
          </NavLink>
        </div>

        <ul className="max-h-52 space-y-0.5 overflow-y-auto px-3 pb-2">
          {(notebooks ?? []).map((notebook) => (
            <li key={notebook.id}>
              <NavLink
                to={`/notebooks/${notebook.id}`}
                onClick={onNavigate}
                title={notebook.title}
                className={cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition',
                  notebook.id === notebookId
                    ? 'bg-neon-soft font-medium text-neon'
                    : 'text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                <span aria-hidden className="shrink-0 text-base leading-none">
                  {notebook.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate">{notebook.title}</span>
                <span className="shrink-0 text-xs text-faint">{notebook.sourceCount}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      {/* The open notebook's nav and its sources, with live status dots. min-h-0
          lets this region shrink so the list scrolls instead of pushing the
          footer off the bottom. */}
      {notebookId ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-border pt-3">
          <nav className="space-y-1 px-3">
            <NavLink
              to={`/notebooks/${notebookId}`}
              // `end` so visiting the sources tab does not also light up Chat.
              end
              onClick={onNavigate}
              className={({ isActive }) => navClass(isActive)}
            >
              <ChatIcon className="size-4" />
              Chat
            </NavLink>
            <NavLink
              to={`/notebooks/${notebookId}/sources`}
              onClick={onNavigate}
              className={({ isActive }) => navClass(isActive)}
            >
              <LayersIcon className="size-4" />
              Sources
            </NavLink>
          </nav>

          <div className="mt-4 flex items-center justify-between px-5 pb-2">
            <span className="text-xs font-semibold tracking-wide text-faint uppercase">
              In this notebook
            </span>
            {sources && sources.length > 0 && (
              <span className="text-xs text-faint">{sources.length}</span>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
            {isPending && !sources ? (
              <div className="grid place-items-center py-6">
                <Spinner className="size-4 text-muted" />
              </div>
            ) : !sources || sources.length === 0 ? (
              <p className="px-3 py-2 text-xs text-faint">No sources yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {sources.map((source) => (
                  <li key={source.id}>
                    <NavLink
                      to={`/notebooks/${notebookId}/sources`}
                      onClick={onNavigate}
                      title={source.title}
                      className="group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-text"
                    >
                      <SourceStatusDot status={source.status} />
                      <span className="min-w-0 flex-1 truncate">{source.title}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <p className="border-t border-border px-5 py-4 text-xs text-faint">
        Each notebook answers only from its own sources.
      </p>
    </div>
  );
}
