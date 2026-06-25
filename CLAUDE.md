# CLAUDE.md

Guidance for working in this repo. Stop Motion Station is a browser-based,
keyboard/gamepad-driven stop-motion capture kiosk (target: Raspberry Pi +
Chromium in kiosk mode). Local-first; an optional backend pushes projects to a
gallery server.

## Commands

- `npm start` — serve at http://localhost:4173 via the dependency-free static
  server (`scripts/serve-static.js`). No bundler, no build step.
- `npm test` — run the Node built-in test runner (`node --test`) over `tests/`.

Node 22+ (developed against Node 26). There are no runtime npm dependencies.

## Architecture

- **No build step.** Plain ES modules loaded directly by the browser. Vendored
  libraries live in `lib/` (`choo.js`, `nanohtml.js`, `mp4-muxer.mjs`, plus
  unused `phaser.js`/`tone.js`). `choo` and `nanohtml` are loaded as classic
  scripts in `index.html`, so **`html` and `Choo` are globals** — views call
  bare `html\`...\`` with no import.
- **`index.js`** creates the Choo app, installs the store, routes every path to
  `views/main-view.js`, mounts, and emits `application:startup`.
- **`app.js`** is the Choo store (one big `applicationStore(state, emitter)`):
  state transitions, keyboard + gamepad shortcuts, persistence orchestration,
  capture, auto-capture, playback, layout, and the sync/video-export wiring.
  It's large; logic is event-driven via `emitter.on(...)` / `emitter.emit(...)`.
- **`views/`** are pure render functions returning `html` templates.
- **`services/`** are side-effectful singletons (camera, storage, persistence,
  playback, sync, video export).
- **`helpers/`** are pure functions — this is where testable logic lives.

## Conventions

- **Verbose, descriptive identifiers** (e.g. `automaticCaptureSessionIdentifier`,
  `updateTimelineScrollTargetAndClampCurrentOffset`). Match the surrounding
  style; avoid terse names and abbreviations.
- **Pure logic goes in `helpers/` and gets a `tests/*.test.js`** using
  `node:assert/strict` + `node:test`. Browser-only behavior (camera, canvas,
  OPFS, WebCodecs) is validated manually — it cannot run under `node --test`.
  When adding behavior, extract the decidable part into a helper and test it.
- Two-space indent, double quotes, semicolons, trailing commas.

## Local persistence (source of truth)

Everything is stored in the **Origin Private File System** (OPFS,
`navigator.storage.getDirectory()`), scoped to the origin + browser profile:

- `frames/<id>.jpg` (full-res) and `frames/<id>-timeline.jpg` (thumbnail) —
  the image bytes (`services/frame-storage-service.js`).
- `projects/project-metadata-list.json` — array of project metadata (browser
  listing). `projects/<projectId>.json` — per-project `{id, title, frames}`
  where frames are **records pointing at storage keys**, not pixels
  (`services/project-storage-service.js`). Transient `blob:` URLs are stripped
  before serialization.
- Root-level `sync-state.json` and `video-export-state.json` hold sync/export
  bookkeeping.

Capture uses a background **Web Worker** pipeline
(`services/capture-persistence-*.js`): the frame record is inserted instantly
for a responsive shutter while JPEG encoding + OPFS writes happen off-thread;
there's a synchronous main-thread fallback. Project JSON is persisted on a
~400ms debounce.

Known gaps: the app never calls `navigator.storage.persist()` (OPFS is
evictable under disk pressure), and `project-metadata-list.json` is
read-modify-written by both the main thread and the worker on independent
queues (a potential lost-update race).

## Backend sync (`services/sync-service.js`)

Push-only upload to `https://smbs.artiswrong.com/api`; OPFS stays canonical.

- **Identity/auth:** a `smbs-table-uid` **cookie** (default `"kaleidoscope"`) is
  the table UID. On init the service obtains an API key by POSTing the UID as
  `device_id` to the unauthenticated `/register/` endpoint and holds it in an
  **in-memory variable only — never persisted** (re-fetched each load;
  `/register/` is idempotent per UID). The UID is also the project `user_id`.
- **No stored key.** Do not reintroduce localStorage/file caching of the API
  key. `sync-config.js` (gitignored) is optional and only overrides
  `apiBaseUrl` or sets `disabled: true`; it holds no key.
- **Frames** are mirrored by 1-based timeline position (`POST .../frames/` with
  `number` + `image`); reorders/replacements re-upload affected positions,
  deletions remove trailing remote frames. State queue retries on failure and a
  1-minute heartbeat re-checks until everything is confirmed synced.
- No project-delete endpoint exists — local deletes only drop sync bookkeeping.

## Background video export (`services/video-export-*.js`)

Low-priority: encodes each project to MP4 in a Web Worker via **WebCodecs**
(`VideoEncoder` H.264) + `lib/mp4-muxer.mjs`, only after the editor has been
**idle 5s** (no input) and never while playing/capturing/timelapsing. Staleness
is tracked by a frame-order+fps signature; the MP4 uploads through the sync
layer's video endpoints. Idle/staleness logic is pure in
`helpers/video-export-policy.js`.

## Status UI

A single fixed dot in the top-right (`views/sync-indicator.js`,
`helpers/sync-indicator-color.js`): green = online + synced, yellow = syncing/
pending/retrying, blue = offline (`navigator.onLine`). Hidden when sync is
disabled.

## Controls

Keyboard and a generic USB gamepad drive everything; there is no mouse-centric
flow. See `README.md` for the full key/button map and the manual browser smoke
test. The Pi kiosk launcher lives in `raspberry-pi/`.
