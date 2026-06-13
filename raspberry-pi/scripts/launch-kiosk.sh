#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPOSITORY_ROOT="$(cd "${SCRIPT_DIRECTORY}/../.." && pwd)"
REPOSITORY_ROOT="${STOP_MOTION_STATION_ROOT:-${DEFAULT_REPOSITORY_ROOT}}"
APPLICATION_PORT="${STOP_MOTION_STATION_PORT:-4173}"
APPLICATION_URL="${STOP_MOTION_STATION_URL:-http://localhost:${APPLICATION_PORT}}"
CHROMIUM_BINARY="${CHROMIUM_BINARY:-chromium-browser}"
CHROMIUM_PROFILE_DIRECTORY="${STOP_MOTION_STATION_CHROMIUM_PROFILE:-${HOME}/.local/share/stop-motion-station/chromium-profile}"

if ! command -v "${CHROMIUM_BINARY}" >/dev/null 2>&1; then
  if command -v chromium >/dev/null 2>&1; then
    CHROMIUM_BINARY="chromium"
  else
    echo "Chromium was not found. Install chromium-browser or chromium before launching kiosk mode." >&2
    exit 1
  fi
fi

cd "${REPOSITORY_ROOT}"
mkdir -p "${CHROMIUM_PROFILE_DIRECTORY}"

python3 -m http.server "${APPLICATION_PORT}" --bind 127.0.0.1 &
STATIC_SERVER_PROCESS_IDENTIFIER="$!"

cleanup() {
  kill "${STATIC_SERVER_PROCESS_IDENTIFIER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if command -v xset >/dev/null 2>&1; then
  xset s off || true
  xset -dpms || true
  xset s noblank || true
fi

exec "${CHROMIUM_BINARY}" \
  --kiosk \
  --user-data-dir="${CHROMIUM_PROFILE_DIRECTORY}" \
  --password-store=basic \
  --no-first-run \
  --disable-sync \
  --disable-session-crashed-bubble \
  --noerrdialogs \
  --disable-infobars \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  "${APPLICATION_URL}"
