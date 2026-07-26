import { createContext, useContext } from 'react';
import type { PublicUser } from '@personallm/shared';

/** Readiness of the Google Identity script, owned by AuthProvider. */
export type GoogleStatus = 'unconfigured' | 'loading' | 'ready' | 'error';

export interface AuthContextValue {
  user: PublicUser | null;
  /** True only while the initial session check is in flight. */
  isLoading: boolean;
  googleStatus: GoogleStatus;
  /** True between Google returning a credential and the session being created. */
  isSigningIn: boolean;
  signInError: string | null;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
