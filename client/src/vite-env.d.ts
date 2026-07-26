/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the API origin when the client is hosted separately from the API. */
  readonly VITE_API_BASE_URL?: string;
  /** Google OAuth client id. Must match the server's GOOGLE_CLIENT_ID. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
