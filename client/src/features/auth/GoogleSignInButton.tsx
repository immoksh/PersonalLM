import { useEffect, useRef } from 'react';
import { useTheme } from '@/features/theme/theme-context';
import { Alert, Spinner } from '@/components/ui';
import { useAuth } from './auth-context';
import { loadGoogleIdentity } from './googleIdentity';

/**
 * Google's own rendered button. It must be theirs rather than a styled button
 * of ours — the ID token flow only issues a credential to a button GIS
 * controls. Initialisation lives in AuthProvider; this only paints it.
 */
export function GoogleSignInButton({ width = 280 }: { width?: number }) {
  const { googleStatus, isSigningIn, signInError } = useAuth();
  const { resolved } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (googleStatus !== 'ready') return;

    let cancelled = false;
    void loadGoogleIdentity().then((google) => {
      if (cancelled || !containerRef.current) return;
      containerRef.current.replaceChildren();
      google.renderButton(containerRef.current, {
        type: 'standard',
        theme: resolved === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
        width,
      });
    });

    return () => {
      cancelled = true;
    };
    // Re-rendered on theme change so Google's button matches the current theme.
  }, [googleStatus, resolved, width]);

  if (googleStatus === 'unconfigured') {
    return (
      <Alert tone="info">
        Google sign-in is not configured. Set{' '}
        <code className="font-mono">VITE_GOOGLE_CLIENT_ID</code> in your{' '}
        <code className="font-mono">.env</code> and restart the dev server.
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex min-h-11 items-center justify-center" aria-live="polite">
        {googleStatus === 'loading' && <Spinner className="size-5 text-muted" />}
        {isSigningIn ? (
          <span className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="size-4" />
            Signing you in…
          </span>
        ) : (
          <div ref={containerRef} hidden={googleStatus !== 'ready'} />
        )}
      </div>

      {signInError && <Alert>{signInError}</Alert>}
    </div>
  );
}
