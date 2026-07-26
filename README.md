# PersonalLM

Ask questions about your own documents and get answers that cite them.

You sign in with Google, add sources — PDFs, web pages, YouTube videos, transcripts, or text you
type — and PersonalLM reads them, indexes them, and answers questions grounded in nothing but
that library. Every answer streams in token by token with inline `[1]` markers that expand into
the exact passages behind the claim.

It is a full-stack TypeScript monorepo: an **Express 5** JSON API, a **React 19** single-page
client, and a shared contract package that both import so the API can never silently drift from
its consumer.

## Stack

| Layer     | Choice                                                                   |
| --------- | ------------------------------------------------------------------------ |
| Server    | Express 5, TypeScript (ESM), better-sqlite3, Zod, JWT, multer, helmet    |
| Retrieval | LangChain, OpenAI (embeddings + chat), Qdrant, BullMQ on Redis           |
| Client    | React 19, Vite, React Router 7, TanStack Query 5, Tailwind CSS 4, TipTap |
| Shared    | Zod schemas and TypeScript types imported by _both_ sides                |
| Tooling   | ESLint (flat config), Prettier, npm workspaces                           |

## Getting started

```bash
npm install
cp .env.example .env
docker compose up -d          # Qdrant on 6333, Redis on 6379
# set OPENAI_API_KEY and the two Google client id vars in .env
npm run dev
```

- Client → <http://localhost:5173>
- API → <http://localhost:4000/api>

Vite proxies `/api` to Express, so the browser talks to a single origin in development — the same
arrangement as production, which keeps cookie behaviour identical in both.

Nothing beyond `npm install` is strictly required to boot: without a `.env` the server falls back
to a development-only JWT secret, and the SQLite file is created and migrated on first run.
Retrieval is the part that needs the extra pieces. **With no `OPENAI_API_KEY` the app still runs**
— sources are stored but never embedded, and `/api/chat` returns a clear "not configured" error
rather than failing cryptically.

---

# How it works, step by step

## 1. Boot

`server/src/index.ts` is the entrypoint, and the order of what happens matters:

1. **The environment is parsed and validated through Zod** ([config/env.ts](server/src/config/env.ts)).
   Every variable gets a type, a range and a default. Cross-field rules are checked too:
   `CHUNK_OVERLAP` must be smaller than `CHUNK_SIZE`; `GOOGLE_CLIENT_ID` is mandatory in
   production; an embedding model the code doesn't know the vector size of must declare
   `OPENAI_EMBEDDING_DIMENSIONS`. A bad value fails the process at boot with a listed reason,
   instead of surfacing as a 500 on some request hours later.
2. **The database opens and migrates itself** ([db/index.ts](server/src/db/index.ts)). Migrations
   run at _import_ time, not from the entrypoint, because services call `db.prepare()` at module
   scope — migrating any later would hit "no such table" on a fresh database. `journal_mode=WAL`
   lets reads proceed during writes, and `foreign_keys=ON` is set explicitly because SQLite
   otherwise ignores `ON DELETE CASCADE` silently.
3. **The Express app is assembled** ([app.ts](server/src/app.ts)): helmet → CORS → JSON body
   parser (1 MB cap) → cookie parser → morgan → a coarse rate limit on `/api` → the routers. In
   production it also serves `client/dist` and falls back to `index.html` for non-`/api` paths, so
   one process and one origin covers the whole app.
4. **The ingestion workers start in-process** unless `INGEST_INLINE_WORKER=false`, so
   `npm run dev` needs nothing extra.
5. **`SIGINT`/`SIGTERM` drain in order** — stop accepting requests, drain the queues, release
   Redis, then close the DB the workers were writing to. A 10-second timer force-exits a wedged
   connection.

Qdrant is _not_ touched at boot. The collection is created lazily on first use, so the API starts
fine with Qdrant down and recovers when it comes back.

## 2. Signing in

Google is the only identity provider, and there is no `/login` route and no login screen. Opening
any URL lands you on the app itself with the shell already rendered; the content area shows a
sign-in gate until a session exists and swaps to your library once it does.

1. `AuthProvider` calls `GET /api/auth/me` on mount. A valid session cookie returns the user; a
   401 simply means "signed out" and renders the gate.
2. Google Identity Services is loaded and initialised **once**, in `AuthProvider`.
   `google.accounts.id.initialize()` registers a _single global_ callback, so letting each button
   initialise would leave only the last-mounted one's handler live — the gate and the profile menu
   therefore share one callback and one piece of sign-in state.
3. You pick an account; Google hands the browser an ID token, which is POSTed to
   `/api/auth/google`.
4. The server **verifies that token** ([utils/googleAuth.ts](server/src/utils/googleAuth.ts)):
   RS256 signature against Google's published keys, issuer, audience (`GOOGLE_CLIENT_ID`) and
   expiry. A token minted for a different app, or forged outright, is rejected here. An
   `email_verified: false` account is refused, because an unverified address could belong to
   someone else.
5. `upsertGoogleUser` finds or creates the local row, **keyed on Google's immutable `sub`** rather
   than the email, since account emails can change. The cached name and picture are refreshed on
   every sign-in.
6. The server mints **its own JWT** rather than reusing the Google token, so session lifetime and
   revocation stay under this application's control, and sets it as an `httpOnly`, `sameSite=lax`
   cookie whose expiry matches the token's exactly.
7. Every subsequent request goes through `requireAuth`, which verifies the JWT **and re-loads the
   user** — a deleted account's unexpired token must not keep working.

Set-up: create an OAuth 2.0 Client ID (Web application) in the Google Cloud Console, add
`http://localhost:5173` to its authorised JavaScript origins, and put the same value in both
`GOOGLE_CLIENT_ID` (server, for audience verification) and `VITE_GOOGLE_CLIENT_ID` (browser).
Without them the gate says so plainly rather than rendering a button that cannot work.

> Users are persisted in SQLite as a placeholder. `upsertGoogleUser` in
> [auth.service.ts](server/src/modules/auth/auth.service.ts) is the single seam to repoint at
> PostgreSQL — token verification, the session cookie and the route guards are all independent of
> the store.

## 3. Adding a source

`Add Source` in the sidebar opens a slide-over listing five types; picking one opens its dialog.

| Type               | Input                                   | Validation                                            |
| ------------------ | --------------------------------------- | ----------------------------------------------------- |
| `PDF`              | Drag & drop or browse                   | `.pdf`, ≤ 25 MB, **one file per upload**              |
| `Plain Text`       | WYSIWYG editor (TipTap)                 | Title required, content non-empty, ≤ 100k characters  |
| `Website URL`      | Single URL                              | http(s) only; a bare domain gets `https://` prepended |
| `YouTube Video`    | Single URL, with live thumbnail preview | watch / `youtu.be` / shorts / embed, normalised by id |
| `VTT / Transcript` | Multi-file drag & drop or browse        | `.vtt`, `.srt`, `.txt`, ≤ 25 MB each, ≤ 10 per upload |

What happens on submit:

1. **The client validates first**, against the schemas in
   [shared/src/sources.ts](shared/src/sources.ts) — so an oversized PDF is rejected before a byte
   is uploaded.
2. **The server re-validates the same schemas**, because a client check is only a convenience.
   `validate({ body, query, params })` runs Zod at the edge and returns `fields` on failure, which
   the client maps straight back onto the offending form input.
3. **File uploads take `kind` from the path** (`/api/sources/files/:kind`), not from a form field,
   so multer's file filter never depends on multipart field ordering to know what it is
   validating. The per-kind file cap lives in `FILE_ACCEPT` and is enforced by both sides.
   Extension is the check that actually holds — browsers report inconsistent MIME types for `.vtt`
   and `.srt`.
4. **Files are written under `UPLOAD_DIR` with generated UUID names.** The client's filename is
   kept only in the database, so it cannot influence the path on disk (no traversal, no
   collisions). A batch upload is inserted in **one transaction**, so the uploaded bytes never
   outlive a partially failed insert.
5. **The row is inserted with `status: 'processing'`** (or `'ready'` when RAG is off — there is
   nothing to process) and `scheduleIngestion(id)` enqueues the background job. The response
   returns immediately; the sidebar shows an amber status dot.
6. **The client polls while anything is processing.** `useSources` sets a 2.5s `refetchInterval`
   that switches itself off once no source is in `processing`, flipping the dots green the moment
   the last Qdrant upsert lands.

## 4. Ingestion: two queues, two stages

Embedding and Qdrant upserts are far too slow to run on the request, so ingestion is queued —
and split across **two** BullMQ queues rather than one.

### Stage one — `source-ingestion` (one job per source)

[queue/ingestion.ts](server/src/queue/ingestion.ts) → [rag/ingest.ts](server/src/modules/rag/ingest.ts)

1. Load the row. If it's gone (deleted before the job ran), stop quietly.
2. Mark it `processing`.
3. **Extract text, dispatching on kind** ([rag/parsers/](server/src/modules/rag/parsers/)):
   - `pdf` — `pdf-parse`, concatenating page text; the pdf.js worker is destroyed in a `finally`.
   - `website` — `fetch` + Cheerio, stripping `script/style/nav/header/footer/svg` and preferring
     `<main>` then `<article>` then `<body>`. Capped at 5 MB and a 15s timeout, and guarded
     against **SSRF**: http(s) only, and the _resolved_ address must be public, so a signed-in
     user cannot make the server fetch cloud metadata (`169.254.169.254`) or localhost admin
     panels.
   - `youtube` — transcript fetched by video id; a video without captions fails with that reason.
   - `transcript` — `.vtt`/`.srt`/`.txt` reduced to prose: timing cues, `WEBVTT` headers, sequence
     numbers, inline tags and consecutively repeated auto-caption lines all dropped.
   - `text` — the editor's HTML tag-stripped, with block elements turned into newlines so
     paragraphs don't run together. A `never` exhaustiveness guard means a new `SourceKind`
     cannot compile without a parser.
4. **Chunk it** ([rag/chunk.ts](server/src/modules/rag/chunk.ts)): ~1000 characters with 150
   characters of overlap (`CHUNK_SIZE` / `CHUNK_OVERLAP`). Horizontal whitespace is collapsed but
   newlines survive, so paragraph boundaries stay available as cut points; cuts land on
   whitespace unless that would shrink a chunk below half size, and each chunk's start is snapped
   to a word boundary. Zero chunks throws, so the source is marked `failed` rather than "ready,
   empty".
5. **Clear the source's existing vectors once**, by payload filter — re-ingesting replaces rather
   than accumulates. Done here, before any batch is queued, because the batches upsert by
   deterministic id and must not delete each other's points.
6. **Fan out** `EMBED_BATCH_SIZE` chunks per job onto the embedding queue, as BullMQ **children**
   of this job.
7. Persist `step: 'embedding'` onto the job and **park in waiting-children**. BullMQ re-runs the
   processor from the top once every child finishes, so the step lives on the job rather than in
   memory — the re-run resumes at step two instead of re-extracting the whole source.

### Stage two — `chunk-embedding` (one job per batch)

[queue/embedding.ts](server/src/queue/embedding.ts) → [rag/vectorStore.ts](server/src/modules/rag/vectorStore.ts)

1. `ensureCollection()` creates the Qdrant collection on demand, sized to the embedding model's
   vector size, with **cosine** distance (how OpenAI embeddings are meant to be compared).
   Several workers booting at once may race to create it; losing that race is not an error. An
   existing collection built for a _different_ model is caught and reported explicitly, instead of
   surfacing as a shape error on every upsert.
2. The batch is embedded in one OpenAI call and upserted in one Qdrant call, with
   `{ userId, sourceId, kind, title, chunkIndex }` as payload. `startIndex` keeps `chunkIndex`
   meaningful across batches embedded in parallel.
3. **Point ids are deterministic** — a SHA-1 of `sourceId:chunkIndex` shaped into a UUID — so a
   retried batch overwrites its own points instead of inserting a second copy.

### What this buys

- A large source is embedded **in parallel** across batches.
- A flaky OpenAI or Qdrant call **retries one batch** rather than re-downloading and re-chunking
  everything. Both queues retry 3 times with exponential backoff (5s, 10s, 20s).
- **Status follows the whole pipeline.** The parent parks until every child completes and only
  then flips the source to `ready`. A batch that exhausts its retries marks the source `failed`
  (`failParentOnFailure` propagates it), and a source that recovers on its second attempt is never
  briefly shown as failed, because the handler only gives up once `attemptsMade` reaches the limit.
- **Workers scale independently.** They run in-process by default; set `INGEST_INLINE_WORKER=false`
  on the API and run `npm run start:worker` to move them out. `INGEST_CONCURRENCY` bounds how many
  sources one worker extracts at once, `EMBED_CONCURRENCY` how many batches it embeds at once.

## 5. Asking a question: multi-query retrieval

`POST /api/chat/stream` with `{ question, sourceIds? }`. Retrieval
([rag/query.ts](server/src/modules/rag/query.ts)) does considerably more than embed the question
and search — a single phrasing of a question is a poor probe into a document collection, so it
searches with several.

1. **Two LLM calls run in parallel** off the raw question:
   - **Query rewriting**, via structured output (Zod schema), returning three things at once:
     a **step-back** question (broader, higher-level, whose answer gives useful background), a
     **rewritten** question (spelling and grammar fixed, made explicit and self-contained), and
     `RETRIEVAL_SUB_QUERIES` **sub-queries** the question decomposes into.
   - **HyDE** — a hypothetical 3–5 sentence answer written in a neutral, encyclopedic tone. It
     doesn't need to be _true_; embedding a passage that _looks like_ the answer lands closer in
     vector space to the real passage than the question does.
   - Both are best-effort: a failure logs a warning and falls back to the original question rather
     than failing the request.
2. **Variants are deduplicated** case-insensitively (rewriting often returns the question
   unchanged), then all of them are embedded in **one** `embedDocuments` call.
3. **Each variant searches Qdrant in parallel** for `RETRIEVAL_TOP_K` chunks, every one of them
   filtered by `metadata.userId`.
4. **Results are fused with Reciprocal Rank Fusion** — each list contributes `1 / (RETRIEVAL_RRF_K
   - rank)`to a chunk's score, so a passage that several different phrasings all surfaced ranks
above one that a single phrasing ranked first. Chunks are keyed by`sourceId:chunkIndex`, and
each keeps its best raw cosine score and the labels of the variants that found it. The top
`RETRIEVAL_FINAL_K` become the answer's context.

**Isolation.** The `userId` filter is not optional and comes from the session cookie, never the
request body — `/api/chat` accepts only `{ question, sourceIds? }`, so a caller cannot ask on
another user's behalf. An optional `sourceIds` narrows the question to specific sources; it is
ANDed with the owner check, so naming someone else's source can only match nothing.

`ensureCollection` also declares keyword payload indexes on `metadata.userId` and
`metadata.sourceId`. Those are not what enforces the isolation — the filter is — but Qdrant needs
them to build its filterable HNSW graph: filtering an unindexed field makes the traversal walk
through points it then discards, and once several users share a collection `userId` is the most
selective filter there is. Without the index, a user with a small library would get back fewer of
their own passages than exist.

## 6. Answering, and streaming it back

[rag/chat.ts](server/src/modules/rag/chat.ts)

1. **Chunks are grouped by source** and numbered `[1]`, `[2]`, … A source contributing several
   passages gets _one_ number, with its passages joined by `…` — so the reference list reads like
   a bibliography rather than a list of fragments.
2. **The prompt** pins the model to those sources: use only what is numbered below, say so if the
   answer isn't there, and cite every claim inline as `[n]` right after the sentence it supports.
   Temperature is 0.2 — low, but non-zero for natural phrasing. Retrieval returning nothing
   short-circuits before the model is ever called, with a plain "I couldn't find anything in your
   sources" reply.
3. **Citations are emitted first**, as a single SSE event, before generation starts. Each carries
   the source's title, kind, URL (websites and YouTube only), passage count, best cosine score and
   up to three snippets, best match first, each collapsed and clipped to 200 characters.
4. **Then answer tokens stream**, one `token` event each, terminated by exactly one `done` — or an
   `error` event carrying a stable code if generation breaks mid-flight.
5. **Transport is SSE over `fetch`, not `EventSource`.** `EventSource` only speaks GET and the
   question travels in a POST body, so the client reads the stream off `fetch()` and frames it
   itself ([lib/sse.ts](client/src/lib/sse.ts)) — buffering partial events, and holding back
   multi-byte characters split across chunks. A failure _before_ the stream opens is still a
   normal JSON error response; the headers are only written once the first event has been produced
   successfully.
6. **Disconnects propagate.** `res.on('close')` aborts an `AbortController` that is threaded into
   the LangChain stream, so hitting Stop or closing the tab stops paying OpenAI for tokens nobody
   will read.

On the client ([useChat.ts](client/src/features/chat/useChat.ts)):

- The assistant turn is appended **empty and `streaming: true`** the moment you submit, so tokens
  have somewhere to land — and while it is still empty the bubble renders as the thinking
  indicator, which is exactly the retrieval wait.
- A `useRef` guards double submits alongside the state flag, because state only reaches the guard
  on the next render and two submits in the same tick would both get through.
- Citations arrive first but are **held back until the answer lands**, then rendered as a numbered
  reference list. Inline `[n]` markers become chips that scroll to and focus their reference;
  expanding one shows the actual passages, which is what makes a citation checkable. A marker the
  citation list doesn't cover stays plain text rather than linking to nothing, and a half-streamed
  `[1` stays literal until its closing bracket arrives.
- **Chat is single-turn and in-memory.** Each question retrieves against itself alone — no history
  is sent, so follow-ups must restate their subject — and nothing survives a reload.

## 7. Deleting a source

`DELETE /api/sources/:id` → the row is checked for ownership (**404, not 403**, so ids cannot be
probed), deleted, its uploaded file removed from disk, and its vectors dropped from Qdrant by
payload filter — no need to have tracked the generated chunk ids. The Qdrant delete is
best-effort: a failure there is logged but must not fail the request, since the row is already
gone.

---

## Theming

Black-and-neon by default, with a light/dark/system toggle in the profile menu under **Change
mode**, reachable whether or not you are signed in. Colours are CSS custom properties on
`[data-theme]`, mapped into Tailwind utilities via `@theme inline`, so switching themes retints the
whole app with no rebuild and no `dark:` variants in components. The choice persists to
`localStorage` and is applied by an inline script in `index.html` before first paint, which avoids
a flash of the wrong theme.

Light mode is not an inversion: neon green at its dark-mode lightness is unreadable on white, so
the accent darkens instead.

## Configuration

All in `.env` at the repo root — shared by the server and, for `VITE_*`, by Vite. See
[.env.example](.env.example).

| Variable                                                      | Default                  | Purpose                                       |
| ------------------------------------------------------------- | ------------------------ | --------------------------------------------- |
| `NODE_ENV`, `PORT`, `CLIENT_ORIGIN`                           | development, 4000, :5173 | Server basics                                 |
| `JWT_SECRET`, `JWT_EXPIRES_IN`                                | dev fallback, `7d`       | Session signing; ≥ 32 chars, required in prod |
| `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID`                  | —                        | Same value; server verifies, browser requests |
| `DATABASE_FILE`, `UPLOAD_DIR`                                 | `data/…`                 | SQLite file and upload directory              |
| `OPENAI_API_KEY`                                              | —                        | **Absent ⇒ all RAG features are off**         |
| `OPENAI_CHAT_MODEL`                                           | `gpt-4o-mini`            | Rewriting, HyDE and answering                 |
| `OPENAI_EMBEDDING_MODEL` / `OPENAI_EMBEDDING_DIMENSIONS`      | `text-embedding-3-small` | Dimensions only needed for unknown models     |
| `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`           | localhost:6333           | API key is Qdrant Cloud only                  |
| `CHUNK_SIZE`, `CHUNK_OVERLAP`                                 | 1000, 150                | Characters; overlap must be smaller           |
| `RETRIEVAL_TOP_K`, `RETRIEVAL_FINAL_K`                        | 8, 6                     | Per-variant depth, then kept after fusion     |
| `RETRIEVAL_RRF_K`, `RETRIEVAL_SUB_QUERIES`                    | 60, 3                    | RRF damping; sub-questions per query          |
| `REDIS_URL`                                                   | localhost:6379           | Backs both queues                             |
| `INGEST_CONCURRENCY`, `EMBED_CONCURRENCY`, `EMBED_BATCH_SIZE` | 2, 4, 64                 | Worker throughput                             |
| `INGEST_INLINE_WORKER`                                        | `true`                   | `false` ⇒ run workers as separate processes   |

## Commands

| Command              | Effect                                                    |
| -------------------- | --------------------------------------------------------- |
| `npm run dev`        | Shared package build, then API and client with hot reload |
| `npm run build`      | Builds shared → server → client                           |
| `npm start`          | Runs the compiled server (also serves `client/dist`)      |
| `npm run typecheck`  | `tsc --noEmit` across all three workspaces                |
| `npm run lint`       | ESLint over the repo                                      |
| `npm run db:migrate` | Applies pending migrations without starting the server    |

Run a standalone ingestion worker with `npm run dev:worker` / `npm run start:worker --workspace
server` (only needed when `INGEST_INLINE_WORKER=false`).

## Layout

```
shared/src/         Zod schemas + types — the single source of truth for the API contract
server/src/
  config/           env.ts (Zod-validated environment), rag.ts (grouped RAG tunables)
  db/               Connection, pragmas, and ordered append-only migrations
  middleware/       validate, requireAuth, upload (multer), errorHandler
  queue/            BullMQ: ingestion.ts (per source) + embedding.ts (per batch)
  modules/rag/      models, extract, parsers/, chunk, vectorStore, query, chat
  modules/<name>/   routes → controller → service, one folder per domain
  app.ts            Middleware pipeline; routes.ts mounts the modules
  index.ts          API entrypoint; worker.ts is the standalone worker process
client/src/
  lib/              Typed fetch wrapper, SSE reader, query client, form-error helpers
  features/auth/    Google Identity loader, sign-in button, sign-in gate
  features/chat/    useChat stream loop, message list, citations, composer
  features/sources/ Source panel, per-type modals, cards, query hooks
  features/theme/   Theme provider + context (light / dark / system)
  components/       Layout, sidebar, profile menu, modal, dropzone, editor
  pages/            ChatPage (landing), SourcesPage, NotFoundPage
```

## API

All responses are `{ "data": ... }` on success and `{ "error": { message, code, fields? } }` on
failure. `code` is a stable machine-readable string; `fields` appears on validation errors.

| Method | Path               | Auth | Purpose                                         |
| ------ | ------------------ | ---- | ----------------------------------------------- |
| `GET`  | `/api/health`      | –    | Liveness probe                                  |
| `POST` | `/api/auth/google` | –    | Exchange a Google ID token for a session cookie |
| `POST` | `/api/auth/logout` | –    | Clear the session cookie                        |
| `GET`  | `/api/auth/me`     | ✓    | Current user                                    |

Sources (all require a session):

| Method   | Path                       | Purpose                                           |
| -------- | -------------------------- | ------------------------------------------------- |
| `GET`    | `/api/sources`             | List — `?kind=&q=`                                |
| `POST`   | `/api/sources/text`        | Create from rich text                             |
| `POST`   | `/api/sources/website`     | Create from a page URL                            |
| `POST`   | `/api/sources/youtube`     | Create from a video URL                           |
| `POST`   | `/api/sources/files/:kind` | Multipart upload, `kind` is `pdf` or `transcript` |
| `DELETE` | `/api/sources/:id`         | Delete, removing the file and its vectors         |

Chat (session required, rate-limited to 20/min per IP in production because every call hits the
embedding _and_ chat APIs several times over):

| Method | Path               | Purpose                                                 |
| ------ | ------------------ | ------------------------------------------------------- |
| `POST` | `/api/chat`        | Answer in one shot → `{ answer, citations[] }`          |
| `POST` | `/api/chat/stream` | The same answer as SSE → `citations`, `token`×n, `done` |

Both take `{ question, sourceIds? }`. The client uses the streaming route; the non-streaming one
is the same pipeline without the incremental delivery.

## Security notes

- **Sessions** are JWTs in `httpOnly`, `sameSite=lax` cookies — unreadable from JavaScript, so XSS
  cannot exfiltrate them, and not attached to cross-site form posts. `secure` is enabled in
  production, and the cookie expires exactly when the token does.
- **There are no passwords.** Google is the only identity provider, its ID token is verified
  signature-and-audience before being trusted, and accounts are keyed on the immutable `sub`.
- **Authorization is enforced in the service layer**: another user's source returns 404, not 403,
  so ids cannot be probed. Retrieval is filtered by `userId` from the cookie, never the body.
- **Rich text is stored as HTML but never rendered with `dangerouslySetInnerHTML`** — cards show a
  tag-stripped preview, so stored content cannot become an XSS vector. Render it as HTML only
  after adding sanitisation.
- **Website ingestion is SSRF-guarded**: http(s) only, resolved address must be public, 15s
  timeout, 5 MB cap.
- **Uploads** get generated names on disk; the client's filename lives only in the database.
- **Input** is validated by Zod at the edge; every SQL statement is parameterised.
- **Rate limits** apply globally to `/api`, and more tightly to sign-in and chat.
- `helmet` sets standard security headers, and the error handler never leaks internals in
  production.

Before deploying: set a real `JWT_SECRET`, set `NODE_ENV=production`, terminate TLS in front of the
app, and add a CSRF token if you introduce cross-origin browser requests (`sameSite=lax` covers the
same-origin setup shipped here).

## Production

```bash
npm run build
NODE_ENV=production npm start
```

The server serves `client/dist` as static files and falls back to `index.html` for non-`/api`
routes, so client-side routes deep-link correctly from a single process and origin. Behind a proxy
it trusts `X-Forwarded-*` so rate limiting and `secure` cookies see the real client.

## Extending it

**A new source type** — `client/src/features/sources/sourceTypes.tsx` is the single registry the
picker, cards and filter chips all read from. A new type is one entry there, one schema in
`shared/src/sources.ts`, one modal, one route in `server/src/modules/sources/`, and one parser in
`server/src/modules/rag/parsers/` (the `never` guard in `extract.ts` will not compile without it).

**A new feature** —

1. Put its schemas and types in `shared/src/`.
2. Add `server/src/modules/<name>/` with `*.routes.ts`, `*.controller.ts`, `*.service.ts`, and
   mount the router in `server/src/routes.ts`.
3. Add `client/src/features/<name>/` with its TanStack Query hooks, plus a page and route.

Because both sides import the same schema, a contract change that breaks the client fails
`npm run typecheck` rather than reaching production.

**Swapping the database** — `better-sqlite3` keeps setup to zero for local work. To move to
Postgres, replace `server/src/db/` and the service modules' queries; nothing else touches the
database, because routes and controllers only ever call services.
