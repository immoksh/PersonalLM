import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicUser } from '@personallm/shared';
import { api, ApiClientError } from '@/lib/api';
import { queryKeys } from '@/lib/queryClient';
import { AuthContext, type AuthContextValue, type GoogleStatus } from './auth-context';
import { GOOGLE_CLIENT_ID, initializeGoogleIdentity, loadGoogleIdentity } from './googleIdentity';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>(
    GOOGLE_CLIENT_ID ? 'loading' : 'unconfigured',
  );
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const { data: user = null, isPending } = useQuery<PublicUser | null>({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        return (await api.auth.me()).user;
      } catch (error) {
        // A 401 here is the expected "signed out" state, not a failure.
        if (error instanceof ApiClientError && error.isUnauthorized) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  const exchangeCredential = useCallback(
    async (credential: string) => {
      setIsSigningIn(true);
      setSignInError(null);
      try {
        const { user: signedIn } = await api.auth.google(credential);
        queryClient.setQueryData(queryKeys.me, signedIn);
      } catch (error) {
        setSignInError(error instanceof Error ? error.message : 'Sign-in failed');
      } finally {
        setIsSigningIn(false);
      }
    },
    [queryClient],
  );

  // Google invokes its callback from outside React, so it reads the current
  // handler through a ref rather than the closure captured at init time.
  const exchangeRef = useRef(exchangeCredential);
  useEffect(() => {
    exchangeRef.current = exchangeCredential;
  });

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    let cancelled = false;
    initializeGoogleIdentity((credential) => void exchangeRef.current(credential))
      .then(() => {
        if (!cancelled) setGoogleStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setGoogleStatus('error');
        setSignInError(error instanceof Error ? error.message : 'Google sign-in is unavailable');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await api.auth.logout();
    queryClient.setQueryData(queryKeys.me, null);
    // Drop every cached response so the next account never sees stale data.
    queryClient.clear();
    setSignInError(null);

    // Without this, Google may silently re-select the same account on the next
    // sign-in, making "sign out" look like it did not work.
    try {
      const google = await loadGoogleIdentity();
      google.disableAutoSelect();
    } catch {
      // Google being unreachable must not block a local sign-out.
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading: isPending, googleStatus, isSigningIn, signInError, signOut }),
    [user, isPending, googleStatus, isSigningIn, signInError, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
