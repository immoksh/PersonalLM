import { useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { SignInGate } from '@/features/auth/SignInGate';
import { useCurrentNotebookId } from '@/features/notebooks/useCurrentNotebookId';
import { AddSourcePanel } from '@/features/sources/AddSourcePanel';
import { AddSourceContext } from '@/features/sources/add-source-context';
import { ProfileMenu } from './ProfileMenu';
import { Sidebar } from './Sidebar';
import { MenuIcon } from './icons';
import { Spinner } from './ui';

/**
 * App shell. The sidebar and header are always present; only the content area
 * changes with sign-in state, so opening the app never lands on a login screen.
 */
export function AppLayout() {
  const { user, isLoading } = useAuth();
  const notebookId = useCurrentNotebookId();
  const [panelOpen, setPanelOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const addSource = useMemo(() => ({ open: () => setPanelOpen(true) }), []);

  return (
    <AddSourceContext.Provider value={addSource}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
        <aside className="sticky top-0 hidden h-dvh lg:block">
          <Sidebar onAddSource={() => setPanelOpen(true)} />
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div
              className="animate-fade-in absolute inset-0 bg-bg-deep/70 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <div className="relative h-full w-72 max-w-[85vw]">
              <Sidebar
                onAddSource={() => {
                  setDrawerOpen(false);
                  setPanelOpen(true);
                }}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
          </div>
        )}

        <div className="relative flex min-h-dvh min-w-0 flex-col">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-grid" aria-hidden />

          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-bg/85 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted transition hover:text-text lg:hidden"
            >
              <MenuIcon className="size-5" />
            </button>

            <span className="font-semibold tracking-tight text-gradient lg:hidden">PersonalLM</span>

            <div className="ml-auto flex items-center gap-2">
              {isLoading ? (
                <span className="size-9 animate-pulse rounded-full bg-surface-2" aria-hidden />
              ) : (
                // Always rendered: signed out it shows a placeholder avatar and
                // offers Login, so the theme choice is never out of reach.
                <ProfileMenu user={user} />
              )}
            </div>
          </header>

          {/* No width cap or padding here: the chat needs the full column height
              to pin its composer, so each page owns its own container. */}
          <main className="relative flex min-w-0 flex-1 flex-col">
            {isLoading ? (
              <div className="grid flex-1 place-items-center py-24">
                <Spinner className="size-8 text-neon" />
              </div>
            ) : user ? (
              <Outlet />
            ) : (
              <SignInGate />
            )}
          </main>
        </div>

        {/* Only mountable with a notebook to file into — the sidebar's button is
            disabled without one, so this never silently swallows a click. */}
        {notebookId && (
          <AddSourcePanel
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            notebookId={notebookId}
          />
        )}
      </div>
    </AddSourceContext.Provider>
  );
}
