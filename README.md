# PersonalLM

Ask questions about your own documents and get answers that cite them.

You sign in with Google, create a **notebook**, and add sources to it — PDFs, web pages, YouTube
videos, transcripts, or text you type. PersonalLM reads them, indexes them, and answers questions
grounded in nothing but that notebook's sources. Every answer streams in token by token with
inline `[1]` markers that expand into the exact passages behind the claim.

Two properties are load-bearing:

- **Notebooks are isolated.** Each one is its own knowledge base. A question asked in one can only
  be answered from the sources filed in it — retrieval is scoped to that notebook's source ids,
  resolved per request, so nothing leaks across the boundary.
- **Every citation is inspectable.** A citation is not just a name — it carries the passage's
  position in the original artefact, so clicking it opens **a PDF at the cited page**, **a video
  seeked to the cited second**, or **the extracted text with the cited characters highlighted**.

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

## 3. Notebooks: the isolation boundary

Signing in lands on the notebook shelf, not on a library — there is no account-wide pile of
sources. Every source belongs to exactly one notebook, and every route below `/notebooks/:id` is
scoped to it.

- **The server enforces it in one place.** `assertOwned` in
  [notebooks.service.ts](server/src/modules/notebooks/notebooks.service.ts) is the single gate that
  every source, upload and chat route passes through, so "can this user read this notebook?" is
  answered once rather than re-derived per endpoint. A notebook you don't own reports **404, not
  403**, so ids cannot be probed.
- **The client cannot forget which one it is in.** `NotebookRoute` resolves `:notebookId` before
  any nested route renders, and `useNotebook()` throws outside one. There is no "list all sources"
  call to make by accident.
- **Deleting a notebook takes everything with it**: the source rows cascade in SQLite, and the
  uploaded files and Qdrant vectors — which live outside the database — are collected before the
  row goes and cleaned up explicitly.

Existing libraries are not lost on upgrade: migration `004_notebooks` creates one notebook per
user who already had sources and files every one of them into it.

## 4. Adding a source

`Add Source` in the sidebar opens a slide-over listing five types; picking one opens its dialog.
The button is disabled outside a notebook, because there would be nowhere to file the result.

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

## 5. Ingestion: two queues, two stages

Embedding and Qdrant upserts are far too slow to run on the request, so ingestion is queued —
and split across **two** BullMQ queues rather than one.

### Stage one — `source-ingestion` (one job per source)

[queue/ingestion.ts](server/src/queue/ingestion.ts) → [rag/ingest.ts](server/src/modules/rag/ingest.ts)

1. Load the row. If it's gone (deleted before the job ran), stop quietly.
2. Mark it `processing`.
3. **Extract text as _located segments_** ([rag/parsers/](server/src/modules/rag/parsers/)). Each
   parser returns `{ text, page?, startSec?, endSec? }[]` rather than one flat string, because the
   position it knows about is the only place that information exists — once it is dropped, no
   later stage can recover which page or second a passage came from.
   - `pdf` — `pdf-parse`, **one segment per page**, carrying the page number and the page total;
     pages with no text layer are skipped so they cannot claim a slice of the document. The
     pdf.js worker is destroyed in a `finally`.
   - `website` — `fetch` + Cheerio, stripping `script/style/nav/header/footer/svg` and preferring
     `<main>` then `<article>` then `<body>`. Capped at 5 MB and a 15s timeout, and guarded
     against **SSRF**: http(s) only, and the _resolved_ address must be public, so a signed-in
     user cannot make the server fetch cloud metadata (`169.254.169.254`) or localhost admin
     panels. A URL that actually serves a PDF is dispatched to the PDF parser, so it keeps page
     numbers like any upload; other binary types are refused rather than decoded as mojibake.
   - `youtube` — transcript fetched by video id, **keeping each cue's offset** so a citation can
     deep-link the player. The library reports milliseconds on one code path and seconds on
     another with nothing to distinguish them, so the unit is inferred from the median cue
     duration — a caption is never on screen for 100 seconds, so anything above that is
     milliseconds.
   - `transcript` — `.vtt`/`.srt` parsed **as cues**, pairing each timing line with its text;
     headers, sequence numbers, inline tags and repeated auto-caption lines are dropped. A file
     with no cues at all (a plain `.txt`) falls back to one untimed segment.
   - `text` — the editor's HTML tag-stripped, with block elements turned into newlines so
     paragraphs don't run together. A `never` exhaustiveness guard means a new `SourceKind`
     cannot compile without a parser.
4. **Flatten and chunk** ([rag/document.ts](server/src/modules/rag/document.ts) →
   [rag/chunk.ts](server/src/modules/rag/chunk.ts)). `buildDocument` joins the segments into one
   canonical string, normalising whitespace **once** and recording where each segment landed.
   `chunkDocument` then splits that string into ~1000-character chunks with 150 of overlap
   (`CHUNK_SIZE` / `CHUNK_OVERLAP`), cutting on whitespace unless that would shrink a chunk below
   half size, and resolves each chunk's locator from the segments it overlaps — the page it
   starts on, and for timed media the span from its first cue to its last. Zero chunks throws, so
   the source is marked `failed` rather than "ready, empty".
5. **Store the canonical text on the source row, verbatim.** Every chunk's `charStart`/`charEnd`
   indexes this exact string, which is what lets the viewer highlight a cited passage without
   re-parsing the PDF or re-fetching the page. Re-normalising it anywhere downstream would shift
   the offsets out from under every citation — [chunk.test.ts](server/src/modules/rag/chunk.test.ts)
   pins that invariant.
6. **Clear the source's existing vectors once**, by payload filter — re-ingesting replaces rather
   than accumulates. Done here, before any batch is queued, because the batches upsert by
   deterministic id and must not delete each other's points.
7. **Fan out** `EMBED_BATCH_SIZE` chunks per job onto the embedding queue, as BullMQ **children**
   of this job.
8. Persist `step: 'embedding'` onto the job and **park in waiting-children**. BullMQ re-runs the
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

## 6. Asking a question: multi-query retrieval

`POST /api/chat/stream` with `{ notebookId, question, sourceIds? }`.

**Scoping comes first, and it is what makes notebooks isolated.** Before anything is embedded,
`retrievableSourceIds` reads the notebook's `ready` sources straight from SQLite and every Qdrant
search runs filtered to that id list (plus `userId`, so a bug in the id resolution still cannot
cross accounts). An optional `sourceIds` from the client narrows further, always by
**intersection** — ids belonging to another notebook are dropped rather than honoured, so the
parameter can only ever shrink the scope. An empty notebook short-circuits before the model is
called.

Filtering on source ids rather than a `notebookId` in the payload is deliberate: it is exact (a
source deleted a moment ago cannot answer), and it keeps working for vectors indexed before
notebooks existed, whose payloads carry no notebook at all.

Retrieval itself ([rag/query.ts](server/src/modules/rag/query.ts)) does considerably more than
embed the question and search — a single phrasing of a question is a poor probe into a document
collection, so it
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

## 7. Answering, and streaming it back

[rag/chat.ts](server/src/modules/rag/chat.ts)

1. **Chunks are grouped by source** and numbered `[1]`, `[2]`, … A source contributing several
   passages gets _one_ number, with its passages joined by `…` — so the reference list reads like
   a bibliography rather than a list of fragments. Each passage is labelled with where it came
   from (`(p. 12)`, `(at 4:05)`), which the model tends to carry into its prose.
2. **The prompt** pins the model to those sources: use only what is numbered below, say so if the
   answer isn't there, and cite every claim inline as `[n]` right after the sentence it supports.
   It also fixes the **output format** — Markdown, with lists for parallel points and a table only
   for genuine comparisons — because a model left to guess emits Markdown anyway, and a renderer
   has to know what it is being handed. Temperature is 0.2 — low, but non-zero for natural
   phrasing. Retrieval returning nothing
   short-circuits before the model is ever called, with a plain "I couldn't find anything in this
   notebook" reply — distinct from the "no indexed sources yet" one, because an empty notebook is
   a setup problem and a miss is a phrasing problem.
3. **Citations are emitted first**, as a single SSE event, before generation starts. Each carries
   the source's title, kind, URL, video id, passage count, best cosine score, and up to three
   **passages**, best match first. A passage is not just a snippet: it carries its
   `charStart`/`charEnd` into the stored extracted text plus its `page` or `startSec`/`endSec` —
   the locator the source viewer needs to open it in place.
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
- **The answer renders as Markdown while it streams**
  ([Markdown.tsx](client/src/features/chat/Markdown.tsx)) — headings, nested lists, tables, code,
  quotes and emphasis. It is ~300 lines rather than a library because the inline `[n]` markers have
  to be interleaved with the formatting at the text-node level, and because every construct in it
  requires its closing delimiter: a half-written `**bold` or `[1` stays literal until the rest
  arrives instead of flickering between styles token by token. Links are rendered only for
  `http(s)` hrefs, since the href is model output. `_underscore_` italics are deliberately not
  supported — mangling a `snake_case` identifier is worse than not styling the rarer construct.
- Citations arrive first but are **held back until the answer lands**, then rendered as a numbered
  reference list. Inline `[n]` markers become chips that scroll to and focus their reference;
  expanding one lists its passages, each tagged with `p. 12` or `4:05` and clickable straight into
  the source viewer. A marker the citation list doesn't cover stays plain text rather than linking
  to nothing, and a half-streamed `[1` stays literal until its closing bracket arrives.
- **Chat is single-turn and in-memory.** Each question retrieves against itself alone — no history
  is sent, so follow-ups must restate their subject — and nothing survives a reload.

## 8. The source viewer: following a citation back

Clicking a passage opens [SourceViewer](client/src/features/sources/viewer/SourceViewer.tsx),
which loads `GET /api/sources/:id` — the source plus the extracted text its offsets address — and
positions itself using the locator the citation carried:

| Kind         | What opens                                                                         |
| ------------ | ---------------------------------------------------------------------------------- |
| `pdf`        | The original file in an `<iframe>` at `#page=N`, served by `GET /sources/:id/file` |
| `youtube`    | The embedded player seeked to the cited second, plus a timestamped watch link      |
| `website`    | A prominent link out — most sites refuse to be framed, so a frame would just break |
| `text`       | The extracted text with the cited characters highlighted                           |
| `transcript` | The same, scrolled to the cued line                                                |

In every case the **indexed text is shown alongside** with the passage marked, because that text
is what the answer was actually generated from — being able to read it is what makes a citation
verifiable rather than merely plausible.

Two details matter more than they look:

- **The highlight is sliced by offset, never searched for.** A passage can appear verbatim several
  times in a document, and searching would mark the first occurrence rather than the one the
  answer used. The offsets come from the indexed chunk, so they are the right occurrence by
  construction. They are clamped before slicing, so a range that outlived a re-index degrades to
  no highlight instead of rendering nothing.
- **`GET /sources/:id/file` is ownership-checked and `Cache-Control: private`.** It streams one
  user's document behind their session cookie, `inline` so the browser renders it, with the
  filename passed through `path.basename` so a user-chosen name cannot inject header syntax.

Sources indexed **before** this existed have no stored text and no locators. They still answer
questions — retrieval is unaffected — but their citations open at the top of the document rather
than at the passage. Re-index them once to pick up page numbers and highlighting.

## 9. Deleting a source

`DELETE /api/sources/:id` → the row is checked for ownership (**404, not 403**, so ids cannot be
probed), deleted, its uploaded file removed from disk, and its vectors dropped from Qdrant by
payload filter — no need to have tracked the generated chunk ids. The Qdrant delete is
best-effort: a failure there is logged but must not fail the request, since the row is already
gone.

## 10. Re-indexing a source

`POST /api/sources/:id/reindex` → same ownership check, then the row flips to `processing` and a
fresh ingestion job is enqueued. It exists to recover a `failed` source (a transient OpenAI or
Qdrant outage, or a website that was down when it was added) and to re-embed everything after a
chunking or embedding-model change.

Two guards: a source already `processing` is rejected with a **409** rather than queued twice —
two runs would race, one clearing the vectors the other is still writing — and the request is a
**400** when RAG is disabled, since there is no pipeline to run. Deduplication beyond that is
unnecessary: `prepareSource` deletes the source's existing points before any batch is queued, so a
re-index replaces its vectors instead of accumulating duplicates.

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
  modules/rag/      models, extract, parsers/, document, chunk, vectorStore, query, chat
  modules/<name>/   routes → controller → service, one folder per domain
  app.ts            Middleware pipeline; routes.ts mounts the modules
  index.ts          API entrypoint; worker.ts is the standalone worker process
client/src/
  lib/              Typed fetch wrapper, SSE reader, query client, form-error helpers
  features/auth/    Google Identity loader, sign-in button, sign-in gate
  features/chat/    useChat stream loop, message list, streaming Markdown, citations, composer
  features/notebooks/ Notebook route guard + context, shelf hooks, create/rename dialog
  features/sources/ Source panel, per-type modals, cards, query hooks, viewer/
  features/theme/   Theme provider + context (light / dark / system)
  components/       Layout, sidebar, profile menu, modal, dropzone, editor
  pages/            NotebooksPage (landing), ChatPage, SourcesPage, NotFoundPage
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

Notebooks (all require a session; each is an isolated knowledge base):

| Method   | Path                 | Purpose                                               |
| -------- | -------------------- | ----------------------------------------------------- |
| `GET`    | `/api/notebooks`     | List, with per-status source counts                   |
| `POST`   | `/api/notebooks`     | Create                                                |
| `GET`    | `/api/notebooks/:id` | One notebook                                          |
| `PATCH`  | `/api/notebooks/:id` | Rename / re-describe / change icon                    |
| `DELETE` | `/api/notebooks/:id` | Delete it, its sources, their files and their vectors |

Sources (all require a session, and all are scoped to a notebook):

| Method   | Path                       | Purpose                                            |
| -------- | -------------------------- | -------------------------------------------------- |
| `GET`    | `/api/sources`             | List — `?notebookId=` required, `&kind=&q=`        |
| `GET`    | `/api/sources/:id`         | One source with its extracted text, for the viewer |
| `GET`    | `/api/sources/:id/file`    | Stream the original upload (`inline`, owner only)  |
| `POST`   | `/api/sources/text`        | Create from rich text                              |
| `POST`   | `/api/sources/website`     | Create from a page URL                             |
| `POST`   | `/api/sources/youtube`     | Create from a video URL                            |
| `POST`   | `/api/sources/files/:kind` | Multipart upload, `kind` is `pdf` or `transcript`  |
| `POST`   | `/api/sources/:id/reindex` | Re-run extraction and embedding for one source     |
| `DELETE` | `/api/sources/:id`         | Delete, removing the file and its vectors          |

Chat (session required, rate-limited to 20/min per IP in production because every call hits the
embedding _and_ chat APIs several times over):

| Method | Path               | Purpose                                                 |
| ------ | ------------------ | ------------------------------------------------------- |
| `POST` | `/api/chat`        | Answer in one shot → `{ answer, citations[] }`          |
| `POST` | `/api/chat/stream` | The same answer as SSE → `citations`, `token`×n, `done` |

Both take `{ notebookId, question, sourceIds? }`. `notebookId` is required — there is no
notebook-wide or account-wide question. The client uses the streaming route; the non-streaming one
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
