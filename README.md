# Stop Motion Station

Stop Motion Station is a browser-based stop-motion capture station designed for a keyboard-first, kiosk-friendly workflow. It captures frames from the browser camera stream, stores projects in the browser Origin Private File System, and plays captured frames back as a quick animation preview.

## Current application shape

- `index.html` loads the vendored browser libraries and the module entry point.
- `index.js` creates the Choo application, installs the application store, routes every path to the main view, mounts the application, and emits the startup event.
- `app.js` owns application state transitions, keyboard shortcuts, project persistence, frame capture, auto-capture, playback, and layout updates.
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

## Keyboard controls

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

## Raspberry Pi direction

The intended deployment target is a Raspberry Pi with a Raspberry Pi Camera running Chromium in kiosk mode. See `raspberry-pi/README.md` for the setup sequence and the scripts that install the kiosk launcher pieces.
