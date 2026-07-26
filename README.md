# PersonalLM

Full-stack TypeScript application: an **Express.js** JSON API and a **React** single-page
client, in one npm-workspaces monorepo with a shared contract package between them.

The main feature is a **source library**: a sidebar `Add Source` button opens a right-hand
panel offering five source types, each with its own collection dialog — multi-file upload for
PDFs and transcripts, a WYSIWYG editor for rich text, and validated URL entry for websites and
YouTube videos.

## Stack

| Layer   | Choice                                                                    |
| ------- | ------------------------------------------------------------------------- |
| Server  | Express 5, TypeScript (ESM), better-sqlite3, Zod, JWT + bcrypt, multer     |
| Client  | React 19, Vite, React Router 7, TanStack Query 5, Tailwind CSS 4, TipTap   |
| Shared  | Zod schemas and TypeScript types imported by _both_ sides                  |
| Tooling | ESLint (flat config), Prettier, npm workspaces                             |

## The source library

`Add Source` (sidebar) opens a slide-over listing the five types. Picking one opens its dialog:

| Type               | Input                                    | Validation                                              |
| ------------------ | ---------------------------------------- | ------------------------------------------------------- |
| `PDF`              | Multi-file drag & drop or browse         | `.pdf`, ≤ 25 MB each, ≤ 10 per upload                   |
| `Plain Text`       | WYSIWYG editor (TipTap)                  | Title required, content non-empty, ≤ 100k characters    |
| `Website URL`      | Single URL                               | http(s) only; a bare domain gets `https://` prepended   |
| `YouTube Video`    | Single URL, with live thumbnail preview  | watch / `youtu.be` / shorts / embed, normalised by id   |
| `VTT / Transcript` | Multi-file drag & drop or browse         | `.vtt`, `.srt`, `.txt`, same size and count limits      |

Every limit lives once in `shared/src/sources.ts` and is enforced on **both** sides: the client
rejects bad files before uploading, and the server re-checks because a client check is only a
convenience.

Rich text is stored as HTML but **never rendered with `dangerouslySetInnerHTML`** — cards show a
tag-stripped preview, so stored content cannot become an XSS vector. Render it as HTML only
after adding sanitisation.

## Sign-in

Google is the only identity provider, and signing in is required to use the app — but there is
no `/login` route and no login screen. Opening any URL lands you on the app itself with the
shell already rendered; the content area shows a sign-in gate until a session exists, and swaps
to your library once it does.

A profile button sits in the top-right corner at all times — your Google picture once signed
in, a placeholder before that. Its menu is the only account surface in the app and holds both
actions: **Change mode** (Light / Dark / System Default) and **Login / Logout**.

Google Identity is initialised once, in `AuthProvider`. `google.accounts.id.initialize()`
registers a *single global* callback, so letting each button initialise would leave only the
last-mounted one's handler live; the gate and the menu therefore share one callback and one
piece of sign-in state.

Set up: create an OAuth 2.0 Client ID (Web application) in the Google Cloud Console, add
`http://localhost:5173` to its authorised JavaScript origins, and put the same value in both
`GOOGLE_CLIENT_ID` (server, for audience verification) and `VITE_GOOGLE_CLIENT_ID` (browser).
Without them the gate says so plainly rather than rendering a button that cannot work.

> The server currently persists users in SQLite as a placeholder. `upsertGoogleUser` in
> `server/src/modules/auth/auth.service.ts` is the single seam to repoint at PostgreSQL — the
> token verification, session cookie and route guards are all independent of the store.

## Theming

Black-and-neon by default, with a light/dark/system toggle in the sidebar. Colours are CSS
custom properties on `[data-theme]`, mapped into Tailwind utilities via `@theme inline`, so
switching themes retints the whole app with no rebuild and no `dark:` variants in components.
The choice persists to `localStorage` and is applied by an inline script in `index.html` before
first paint, which avoids a flash of the wrong theme. It lives in the profile menu under
**Change mode**, reachable whether or not you are signed in.

Light mode is not an inversion: neon green at its dark-mode lightness is unreadable on white,
so the accent darkens instead.

## Getting started

```bash
npm install
cp .env.example .env     # optional in dev; required before deploying
npm run dev
```

- Client → <http://localhost:5173>
- API → <http://localhost:4000/api>

Vite proxies `/api` to Express, so the browser talks to a single origin in development — the
same arrangement as production, which keeps cookie behaviour identical in both.

Without a `.env`, the server falls back to a development-only JWT secret and refuses to boot in
production without a real one. The SQLite file is created and migrated on first run.

## Retrieval & chat (RAG)

Sources aren't just stored — their text is chunked, embedded, and made searchable so `/api/chat`
can answer questions grounded in the user's own library. It's built on **LangChain**, **OpenAI**
(embeddings + chat), **Qdrant** (vector store, `server/src/modules/rag/`), and **BullMQ** queues
on **Redis** for background ingestion (`server/src/queue/`).

To enable it:

```bash
docker compose up -d              # starts Qdrant (6333) and Redis (6379)
# then set in .env:
#   OPENAI_API_KEY=sk-...
npm run dev
```

RAG is optional. With no `OPENAI_API_KEY`, the server still boots and sources are stored as
before — they just aren't embedded, and `/api/chat` returns a clear "not configured" error.

How it works:

- **Ingestion is queued, not inline** — and in two stages, on two queues (embedding + Qdrant
  upserts are too slow to run on the request). Creating a source marks it `processing` and
  enqueues a `source-ingestion` job. That job extracts text per kind (PDF via `pdf-parse`,
  websites via `fetch` + Cheerio with an SSRF guard, YouTube via transcript fetch, `.vtt`/`.srt`
  cue-stripping, rich-text via tag-stripping) and splits it into overlapping ~1k-char chunks.
  The chunks are then fanned out over the `chunk-embedding` queue, `EMBED_BATCH_SIZE` per job,
  and each of those jobs embeds its batch and upserts it to Qdrant with
  `{ userId, sourceId, kind, title, chunkIndex }` metadata. So a large source is embedded in
  parallel, and a flaky OpenAI/Qdrant call retries one batch instead of re-downloading and
  re-chunking everything. Every job retries with exponential backoff (3 attempts); points are
  upserted under deterministic ids, so a retried batch overwrites rather than duplicates.
- **The source's status follows both stages.** The embedding jobs are BullMQ children of the
  source's job, which parks in waiting-children until every batch is done and only then flips the
  source to `ready`. A batch that exhausts its retries marks it `failed`.
- **The Qdrant collection is created on demand** by `ensureCollection`, sized to the embedding
  model's vector size (`OPENAI_EMBEDDING_DIMENSIONS` for a model whose size isn't built in).
  Several workers booting at once may race to create it; losing that race is not an error. An
  existing collection built for a *different* model is caught and reported explicitly, instead of
  surfacing as a shape error on every upsert.
- **The workers run in-process by default** so `npm run dev` needs nothing extra. Set
  `INGEST_INLINE_WORKER=false` and run `npm run start:worker` (or `dev:worker`) to scale workers
  as separate processes; `INGEST_CONCURRENCY` bounds how many sources one worker extracts at
  once, and `EMBED_CONCURRENCY` how many batches it embeds at once.
- **Retrieval** is always filtered by `userId`, so one user can never retrieve another's chunks;
  an optional `sourceIds` list narrows a question to specific sources. The `userId` comes from the
  session cookie, never from the request body — `/api/chat` accepts only `{ question, sourceIds? }`,
  so a caller cannot ask on another user's behalf, and a `sourceIds` naming someone else's source
  simply matches nothing (it is ANDed with the owner check, so it can only narrow the scope).
  `ensureCollection` also declares keyword payload indexes on `metadata.userId` and
  `metadata.sourceId`. Those aren't what enforces the isolation — the filter is — but Qdrant needs
  them to build its filterable HNSW graph: filtering an unindexed field makes the traversal walk
  through points it then discards, and once several users share a collection `userId` is the most
  selective filter there is, so without the index a user with a small library would get back fewer
  of their own passages than exist.
- **Deleting** a source removes its vectors from Qdrant by payload filter.

Config (all in `.env`, see `.env.example`): `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`,
`OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_DIMENSIONS`, `QDRANT_URL`, `QDRANT_API_KEY` (Qdrant Cloud only), `QDRANT_COLLECTION`,
`REDIS_URL`, `INGEST_CONCURRENCY`, `INGEST_INLINE_WORKER`, `EMBED_BATCH_SIZE`, `EMBED_CONCURRENCY`.

## Commands

| Command              | Effect                                                    |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | Shared package build, then API and client with hot reload |
| `npm run build`      | Builds shared → server → client                           |
| `npm start`          | Runs the compiled server (also serves `client/dist`)      |
| `npm run typecheck`  | `tsc --noEmit` across all three workspaces                |
| `npm run lint`       | ESLint over the repo                                      |
| `npm run db:migrate` | Applies pending migrations without starting the server    |

Run a standalone ingestion worker with `npm run dev:worker` / `npm run start:worker --workspace server`
(only needed when `INGEST_INLINE_WORKER=false`).

## Layout

```
shared/src/         Zod schemas + types — the single source of truth for the API contract
server/src/
  config/env.ts     Environment parsed and validated through Zod at boot
  db/               Connection, pragmas, and ordered append-only migrations
  middleware/       validate, requireAuth, errorHandler
  modules/<name>/   routes → controller → service, one folder per domain
  app.ts            Middleware pipeline; routes.ts mounts the modules
client/src/
  lib/              Typed fetch wrapper, query client, form-error helpers
  features/theme/   Theme provider + context (light / dark / system)
  features/auth/    Google Identity loader, sign-in button, sign-in gate
  features/sources/ Source panel, per-type modals, cards, query hooks
  components/       Layout, sidebar, profile menu, modal, dropzone, editor
  pages/            Route-level screens
```

### Adding a source type

`client/src/features/sources/sourceTypes.tsx` is the single registry the picker, cards and
filter chips all read from. A new type is one entry there, one schema in `shared/src/sources.ts`,
one modal, and one route in `server/src/modules/sources/`.

### Adding a feature

1. Put its schemas and types in `shared/src/`.
2. Add `server/src/modules/<name>/` with `*.routes.ts`, `*.controller.ts`, `*.service.ts`, and
   mount the router in `server/src/routes.ts`.
3. Add `client/src/features/<name>/` with its TanStack Query hooks, plus a page and route.

Because both sides import the same schema, a contract change that breaks the client fails
`npm run typecheck` rather than reaching production.

## API

All responses are `{ "data": ... }` on success and `{ "error": { message, code, fields? } }` on
failure. `code` is a stable machine-readable string; `fields` appears on validation errors.

| Method | Path               | Auth | Purpose                                        |
| ------ | ------------------ | ---- | ---------------------------------------------- |
| `GET`  | `/api/health`      | –    | Liveness probe                                 |
| `POST` | `/api/auth/google` | –    | Exchange a Google ID token for a session cookie |
| `POST` | `/api/auth/logout` | –    | Clear the session cookie                       |
| `GET`  | `/api/auth/me`     | ✓    | Current user                                   |

Sources:

| Method   | Path                         | Purpose                                          |
| -------- | ---------------------------- | ------------------------------------------------ |
| `GET`    | `/api/sources`               | List — `?kind=&q=`                               |
| `POST`   | `/api/sources/text`          | Create from rich text                            |
| `POST`   | `/api/sources/website`       | Create from a page URL                           |
| `POST`   | `/api/sources/youtube`       | Create from a video URL                          |
| `POST`   | `/api/sources/files/:kind`   | Multipart upload, `kind` is `pdf` or `transcript` |
| `DELETE` | `/api/sources/:id`           | Delete, removing the stored file                 |

Chat:

| Method | Path        | Purpose                                                             |
| ------ | ----------- | ------------------------------------------------------------------- |
| `POST` | `/api/chat` | Answer a question from the user's sources — `{ question, sourceIds? }` |

`/api/chat` requires a session, is rate-limited (every call hits the embedding + chat APIs), and
returns `{ answer, citations[] }` where each citation names the source and matched snippet. It
retrieves only the asking user's chunks.

All source routes require a session. `kind` is taken from the path rather than a form field so
multer's file filter never depends on multipart field ordering to know what it is validating.
Uploads are stored under `UPLOAD_DIR` with generated names — the client's filename is kept only
in the database, so it cannot influence the path on disk.

## Security notes

- **Sessions** are JWTs in `httpOnly`, `sameSite=lax` cookies — unreadable from JavaScript, so
  XSS cannot exfiltrate them, and not attached to cross-site form posts. `secure` is enabled in
  production.
- **There are no passwords.** Google is the only identity provider. The browser sends the
  Google ID token, and the server verifies its signature, issuer, audience and expiry before
  trusting it — a token minted for a different app, or forged outright, is rejected. Accounts
  are keyed on Google's immutable `sub`, not the email, because account emails can change.
- **Authorization** is enforced in the service layer: a source belonging to another user returns
  404, not 403, so ids cannot be probed.
- **Input** is validated by Zod at the edge; every SQL statement is parameterised.
- **Rate limits** apply globally to `/api` and more tightly to the sign-in endpoint.
- `helmet` sets standard security headers, and the error handler never leaks internals in
  production.

Before deploying: set a real `JWT_SECRET`, set `NODE_ENV=production`, terminate TLS in front of
the app, and add a CSRF token if you introduce cross-origin browser requests (`sameSite=lax`
covers the same-origin setup shipped here).

## Production

```bash
npm run build
NODE_ENV=production npm start
```

The server serves `client/dist` as static files and falls back to `index.html` for non-`/api`
routes, so client-side routes deep-link correctly from a single process and origin.

## Swapping the database

`better-sqlite3` keeps setup to zero for local work. To move to Postgres, replace
`server/src/db/` and the two service modules' queries — nothing else touches the database,
because routes and controllers only ever call services.
