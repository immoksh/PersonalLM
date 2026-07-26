import { NavLink } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useSources } from '@/features/sources/useSources';
import { SourceStatusDot } from '@/features/sources/SourceStatusDot';
import { ChatIcon, LayersIcon, PlusIcon } from './icons';
import { Button, Spinner, cx } from './ui';

interface SidebarProps {
  onAddSource: () => void;
  /** Lets the mobile drawer close itself once a destination is chosen. */
  onNavigate?: () => void;
}

const NAV = [
  { to: '/', label: 'Chat', Icon: ChatIcon },
  { to: '/sources', label: 'Sources', Icon: LayersIcon },
];

export function Sidebar({ onAddSource, onNavigate }: SidebarProps) {
  const { user } = useAuth();
  // Only the signed-in user has a library; skip the request (and its 401) otherwise.
  const { data: sources, isPending } = useSources('all', '', { enabled: Boolean(user) });

  return (
    <div className="flex h-full flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid size-9 place-items-center rounded-xl bg-neon text-neon-ink glow">
          <LayersIcon className="size-5" />
        </span>
        <span className="text-lg font-semibold tracking-tight text-gradient">PersonalLM</span>
      </div>

      <div className="px-4 pb-4">
        {/* Disabled rather than hidden when signed out: the button is the main
            affordance, and hiding it makes the sidebar look broken. */}
        <Button
          onClick={onAddSource}
          disabled={!user}
          title={user ? undefined : 'Sign in to add sources'}
          className="w-full"
        >
          <PlusIcon className="size-4" />
          Add Source
        </Button>
      </div>

      <nav className="space-y-1 px-3">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            // `end` so visiting /sources does not also light up the "/" link.
            end
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-neon-soft text-neon'
                  : 'text-muted hover:bg-surface-2 hover:text-text',
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Library: every source with a live ingestion-status dot. min-h-0 lets
          this region shrink so the list scrolls instead of pushing the footer. */}
      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pb-2">
          <span className="text-xs font-semibold tracking-wide text-faint uppercase">Library</span>
          {sources && sources.length > 0 && (
            <span className="text-xs text-faint">{sources.length}</span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {!user ? null : isPending && !sources ? (
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
                    to="/sources"
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

      <p className="border-t border-border px-5 py-4 text-xs text-faint">
        Your library is private to your Google account.
      </p>
    </div>
  );
}
