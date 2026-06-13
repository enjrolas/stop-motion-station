# Raspberry Pi kiosk setup

This folder contains the early setup pieces for running Stop Motion Station as a Raspberry Pi camera kiosk.

The goal is:

1. Boot Raspberry Pi OS into the graphical desktop.
2. Start a local static server for this repository.
3. Launch Chromium in kiosk mode pointed at the local application URL.
4. Keep the display awake.
5. Make the setup easy to reinstall on a fresh Pi.

## Expected hardware

- Raspberry Pi with a recent Raspberry Pi OS desktop image.
- Raspberry Pi Camera or another camera exposed to Chromium through the operating system camera stack.
- Keyboard or dedicated button controller that can emit the app's keyboard shortcuts.
- Display connected to the Pi.
- Python 3 for the kiosk launcher's local static server.

## First-time operating system setup

1. Flash Raspberry Pi OS with desktop support.
2. Enable the camera interface if your camera model and operating system image require it.
3. Confirm Chromium can see the camera outside kiosk mode.
4. Copy or clone this repository to the Pi.
5. From the repository root, run the setup script:

```sh
raspberry-pi/scripts/install-kiosk-mode.sh
```

6. Reboot the Pi.

## Configuration knobs

The generated kiosk launcher reads these environment variables if they are set before launch:

- `STOP_MOTION_STATION_ROOT`: repository path. Defaults to the current repository path recorded when the installer runs.
- `STOP_MOTION_STATION_PORT`: local static server port. Defaults to `4173`.
- `STOP_MOTION_STATION_URL`: Chromium URL. Defaults to `http://localhost:${STOP_MOTION_STATION_PORT}`.

## Scripts

- `scripts/install-kiosk-mode.sh` installs a user-level systemd service and a desktop autostart entry.
- `scripts/launch-kiosk.sh` starts the local static server and Chromium kiosk session.

## Notes and open tasks

- Camera permission behavior should be tested on the target Pi. We may need a Chromium policy or profile preconfiguration once we know the final application origin.
- The current local static server uses Python's built-in HTTP server. That keeps deployment simple, but a system package such as nginx may be preferable later.
- The kiosk launcher assumes a graphical desktop session and Chromium are available.
- Hardware button wiring is not implemented yet. A future script can map General Purpose Input Output button presses to the keyboard shortcuts used by the browser app.
