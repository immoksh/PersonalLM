import { useEffect, useId, useRef, useState } from 'react';
import type { PublicUser } from '@personallm/shared';
import { useAuth } from '@/features/auth/auth-context';
import { GoogleSignInButton } from '@/features/auth/GoogleSignInButton';
import { useTheme, type ThemePreference } from '@/features/theme/theme-context';
import { Avatar } from './Avatar';
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon, UserIcon } from './icons';
import { cx } from './ui';

const THEMES: Array<{ value: ThemePreference; label: string; Icon: typeof SunIcon }> = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System Default', Icon: MonitorIcon },
];

/**
 * The single account control, top-right. Present whether or not anyone is
 * signed in: it shows the Google picture when there is one and a placeholder
 * otherwise, and its menu carries both the theme choice and sign in / sign out.
 */
export function ProfileMenu({ user }: { user: PublicUser | null }) {
  const { signOut, isSigningIn } = useAuth();
  const { preference, setPreference } = useTheme();

  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      // Google renders its account chooser into its own overlay outside this
      // subtree; treating that as an outside click would close the menu
      // mid-sign-in.
      if (target instanceof Element && target.closest('[id^="credential_picker"]')) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus(); // Return focus so keyboard users are not stranded.
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Signing in from inside the menu should dismiss it once it succeeds.
  const wasSignedIn = useRef(Boolean(user));
  useEffect(() => {
    if (user && !wasSignedIn.current) setOpen(false);
    wasSignedIn.current = Boolean(user);
  }, [user]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={user ? `Account menu for ${user.name}` : 'Account menu — not signed in'}
        className={cx(
          'grid size-9 place-items-center rounded-full transition',
          'ring-2 ring-offset-2 ring-offset-bg',
          open ? 'ring-neon' : 'ring-transparent hover:ring-border-strong',
        )}
      >
        {user ? (
          <Avatar user={user} className="size-9" />
        ) : (
          <span className="grid size-9 place-items-center rounded-full border border-border bg-surface-2 text-muted">
            <UserIcon className="size-5" />
          </span>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="animate-slide-up absolute right-0 z-50 mt-2 w-68 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        >
          <div className="h-px w-full bg-gradient-to-r from-transparent via-neon to-transparent" />

          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            {user ? (
              <>
                <Avatar user={user} className="size-10" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{user.name}</p>
                  <p className="truncate text-xs text-faint">{user.email}</p>
                </div>
              </>
            ) : (
              <>
                <span className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-surface-2 text-muted">
                  <UserIcon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">Not signed in</p>
                  <p className="text-xs text-faint">Sign in to build your library</p>
                </div>
              </>
            )}
          </div>

          <div className="border-b border-border py-1.5" role="group" aria-label="Theme">
            <p className="px-4 pt-1 pb-1.5 text-xs font-medium tracking-wide text-faint uppercase">
              Change mode
            </p>
            {THEMES.map(({ value, label, Icon }) => {
              const active = preference === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => setPreference(value)}
                  className={cx(
                    'flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition',
                    active ? 'text-neon' : 'text-text hover:bg-surface-2',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{label}</span>
                  {active && <CheckIcon className="size-4 shrink-0" />}
                </button>
              );
            })}
          </div>

          {user ? (
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full px-4 py-3 text-left text-sm font-medium text-text transition hover:bg-surface-2 disabled:opacity-60"
            >
              {signingOut ? 'Signing out…' : 'Logout'}
            </button>
          ) : (
            <div className="px-4 py-3">
              <p className="mb-2 text-xs font-medium tracking-wide text-faint uppercase">Login</p>
              <GoogleSignInButton width={232} />
              {isSigningIn && <span className="sr-only">Signing you in</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
