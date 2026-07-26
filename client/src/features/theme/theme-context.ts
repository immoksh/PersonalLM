import { createContext, useContext } from 'react';

/** What the user picked. `system` follows the OS preference live. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What is actually painted right now. */
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return value;
}

export const THEME_STORAGE_KEY = 'personallm.theme';
