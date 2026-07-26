import { createContext, useContext } from 'react';

export interface AddSourceContextValue {
  /** Opens the Add Source slide-over. */
  open: () => void;
}

export const AddSourceContext = createContext<AddSourceContextValue | null>(null);

/**
 * Reaches the panel from any depth.
 *
 * Deliberately not React Router's outlet context: that does not pass through
 * nested outlets, so it breaks as soon as a wrapper route is added between the
 * layout and the page.
 */
export function useAddSource(): AddSourceContextValue {
  const value = useContext(AddSourceContext);
  if (!value) {
    throw new Error('useAddSource must be used inside the app layout');
  }
  return value;
}
