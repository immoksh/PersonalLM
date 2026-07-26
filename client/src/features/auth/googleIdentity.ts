/** Minimal typings for the slice of Google Identity Services we use. */
export interface GoogleCredentialResponse {
  credential?: string;
}

export interface GoogleButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  text?: 'signin_with' | 'signup_with' | 'continue_with';
  shape?: 'rectangular' | 'pill';
  logo_alignment?: 'left' | 'center';
  width?: number;
}

interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

let loader: Promise<GoogleIdApi> | null = null;

/**
 * Loads the Google Identity Services script once and resolves with its API.
 * Concurrent callers share a single promise, so mounting the button in several
 * places does not inject the script repeatedly.
 */
export function loadGoogleIdentity(): Promise<GoogleIdApi> {
  if (loader) return loader;

  loader = new Promise<GoogleIdApi>((resolve, reject) => {
    const ready = window.google?.accounts?.id;
    if (ready) {
      resolve(ready);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement('script');

    const onLoad = () => {
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error('Google Identity Services loaded without an accounts.id API'));
    };

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener(
      'error',
      () => {
        // Reset so a later attempt can retry after the network recovers.
        loader = null;
        reject(new Error('Could not reach Google. Check your connection and try again.'));
      },
      { once: true },
    );

    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return loader;
}

let initialized = false;

/**
 * Initialises Google Identity exactly once for the whole app.
 *
 * `initialize` stores a single global callback, so calling it from each button
 * would leave only the last one's handler live — the others would render a
 * button that reports its result somewhere else. One owner (AuthProvider)
 * registers the callback; buttons only call `renderButton`.
 */
export async function initializeGoogleIdentity(
  onCredential: (credential: string) => void,
): Promise<GoogleIdApi> {
  const google = await loadGoogleIdentity();

  if (!initialized) {
    google.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        if (response.credential) onCredential(response.credential);
      },
      // One Tap stays off: the profile menu and the gate are the deliberate
      // entry points, and an unprompted overlay on load is hostile.
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    initialized = true;
  }

  return google;
}
