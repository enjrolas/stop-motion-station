# Stop Motion Station

Stop Motion Station is a browser-based stop-motion capture station designed for a keyboard- and gamepad-friendly kiosk workflow. It captures frames from the browser camera stream, stores projects in the browser Origin Private File System, and plays captured frames back as a quick animation preview.

## Current application shape

- `index.html` loads the vendored browser libraries and the module entry point.
- `index.js` creates the Choo application, installs the application store, routes every path to the main view, mounts the application, and emits the startup event.
- `app.js` owns application state transitions, keyboard and gamepad shortcuts, project persistence, frame capture, auto-capture, playback, and layout updates.
- `views/` contains the project browser, camera preview, controls panel, and timeline panel.
- `services/` contains camera, frame storage, project storage, and playback service objects.
- `helpers/` contains pure operations for frame editing, project browser selection, layout, and frame identifiers.
- `raspberry-pi/` contains setup notes and scripts for preparing a Raspberry Pi kiosk installation.

## Requirements

- Node.js 22 or newer for the local static server and automated tests.
- A modern Chromium-based browser is recommended.
- Camera access requires a secure context. `localhost` works during development; a deployed device should use a trusted local origin or a kiosk configuration that allows camera access for the application origin.
- Project and original-frame storage requires browser support for the Origin Private File System API.
- The Raspberry Pi target should use a recent Raspberry Pi OS image with Chromium and Python 3 installed.

## Run locally

```sh
npm start
```

Then open:

```text
http://localhost:4173
```

The `npm start` command uses the dependency-free Node static server in `scripts/serve-static.js`, so the project can run without installing a bundler or development server package.

## Test

```sh
npm test
```

The current automated tests cover pure helper behavior. Browser-only behavior such as camera access, canvas encoding, audio playback, and Origin Private File System persistence still needs manual browser validation.

## Controls

### Project browser

- Arrow keys move the selected project tile.
- Space activates the selected tile.
- Selecting an existing project opens its action dialog.
- Space activates the selected dialog action.
- Escape or W closes the project dialog.

### Project editor

- Space captures a frame.
- Up plays the current sequence.
- Left and Right move the timeline selection.
- Shift + Left and Shift + Right reorder the selected frame.
- Down, Delete, or Backspace deletes the selected frame, or the frame immediately before the selected gap.
- Press and release Up and Space together to start auto-capture.
- Press any other key during auto-capture to stop it.
- Escape or W returns to the project browser.

### Generic USB joystick

- B0 maps to Back.
- B5 maps to Play.
- B1 maps to Previous.
- B2 maps to Next.
- B4 maps to Delete.
- B3 maps to Capture / confirm.
- Press and release Play and Capture together to start auto-capture.
- Press any other mapped gamepad button during auto-capture to stop it.

## Manual browser smoke test

Use this checklist after application changes:

1. Start the static server with `npm start`.
2. Open the app in Chromium.
3. Create a new project from the project browser.
4. Start the camera and grant camera permission.
5. Capture a frame with Space.
6. Capture several more frames.
7. Navigate the timeline with Left and Right.
8. Reorder a selected frame with Shift + Left or Shift + Right.
9. Play the sequence with Up.
10. Delete a frame with Down, Delete, or Backspace.
11. Return to the project browser with Escape or W.
12. Reopen the project and confirm its frames are still available.
13. Delete the project from the project browser action dialog.

## Backend sync

Projects and their captured frames can be pushed to the Stop Motion Bible
Stories backend gallery (`https://smbs.artiswrong.com`). Sync is **one-way
(upload only)**: the browser's Origin Private File System remains the source of
truth, and local changes are mirrored up to the server.

### Setup

1. Copy the config template and add the table API key issued for this device:

   ```sh
   cp sync-config.example.js sync-config.js
   ```

   ```js
   // sync-config.js  (gitignored — never commit the key)
   export default {
     apiKey: "your-table-api-key-here",
     apiBaseUrl: "https://smbs.artiswrong.com/api",
   };
   ```

2. Reload the app. The project browser and editor show a "Backend sync"
   indicator (ready / syncing / synced / retrying). Set `apiKey` to `null` to
   disable sync; the app runs normally offline.

### Behavior

- On startup every saved project is pushed; afterwards each capture, reorder,
  delete, and title edit triggers a debounced background sync.
- Each project is created once on the server (a stable per-device `user_id` is
  generated and stored in `localStorage`). Frames are uploaded by 1-based
  timeline position, so reorders and replacements re-upload the affected
  positions and local deletions remove the trailing remote frames.
- Sync bookkeeping (the local→remote id map and uploaded-frame positions) is
  kept in an OPFS `sync-state.json` file and survives reloads.
- Failed network calls do not block capture; the queue retries automatically.
- A heartbeat checks once a minute and, if anything is not confirmed synced,
  re-enqueues every project and retries — covering transient outages.
- The backend has no project-delete endpoint, so deleting a project locally
  only forgets its sync bookkeeping — the remote copy is left in place.

### Background video export

When backend sync is enabled, projects are also rendered to an MP4 and uploaded
to the backend `video` endpoint. Rendering is deliberately **low priority** so it
never competes with capture or playback:

- Encoding runs in a dedicated Web Worker (`services/video-export-worker.js`)
  using the **WebCodecs** `VideoEncoder` and an MP4 muxer (`lib/mp4-muxer.mjs`).
  The main UI thread is never blocked.
- A render only starts after the editor has been **idle for 5 seconds** (no
  keyboard or gamepad input) and never while playing, capturing, or running a
  timelapse. Any frame change cancels an in-flight render so stale video is not
  uploaded.
- Each project's frame order + playback speed forms a signature; a project is
  only re-encoded when that signature changes since the last successful upload
  (tracked in OPFS `video-export-state.json`).
- The finished MP4 is uploaded via the project's `video` endpoint, and frame
  edits call `video/mark-changed` so the backend knows the stored film is stale
  until the next render lands.
- WebCodecs H.264 encoding requires a supported (ideally hardware) encoder. If
  it is unavailable the app degrades gracefully and simply skips video export;
  frame sync is unaffected. Verify on the Raspberry Pi target.

The encode tuning (idle threshold, minimum frame count) lives in the pure,
unit-tested `helpers/video-export-policy.js`. The project-browser "Export Video"
button remains a manual stub for now; background export is automatic.

## Raspberry Pi direction

The intended deployment target is a Raspberry Pi with a Raspberry Pi Camera running Chromium in kiosk mode. See `raspberry-pi/README.md` for the setup sequence and the scripts that install the kiosk launcher pieces.
