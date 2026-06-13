#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPOSITORY_ROOT="$(cd "${SCRIPT_DIRECTORY}/../.." && pwd)"
REPOSITORY_ROOT="${STOP_MOTION_STATION_ROOT:-${DEFAULT_REPOSITORY_ROOT}}"
APPLICATION_PORT="${STOP_MOTION_STATION_PORT:-4173}"
RUN_MODE="${STOP_MOTION_STATION_RUN_MODE:-local}"
LOCAL_APPLICATION_URL="${STOP_MOTION_STATION_URL:-http://localhost:${APPLICATION_PORT}}"
REMOTE_APPLICATION_URL="${STOP_MOTION_STATION_REMOTE_URL:-https://wmacfarl.github.io/stop-motion-station/}"
CHROMIUM_BINARY="${CHROMIUM_BINARY:-chromium-browser}"
CHROMIUM_PROFILE_DIRECTORY="${STOP_MOTION_STATION_CHROMIUM_PROFILE:-${HOME}/.local/share/stop-motion-station/chromium-profile}"
STATIC_SERVER_PROCESS_IDENTIFIER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      RUN_MODE="local"
      shift
      ;;
    --remote)
      RUN_MODE="remote"
      shift
      ;;
    --url)
      if [[ $# -lt 2 ]]; then
        echo "--url requires a URL argument." >&2
        exit 1
      fi
      LOCAL_APPLICATION_URL="$2"
      REMOTE_APPLICATION_URL="$2"
      shift 2
      ;;
    --help|-h)
      cat <<HELP_EOF
Usage: raspberry-pi/scripts/launch-kiosk.sh [--local|--remote] [--url URL]

Modes:
  --local   Start a local static server and open http://localhost:4173.
  --remote  Do not start a server; open the GitHub Pages deployment.

Environment:
  STOP_MOTION_STATION_RUN_MODE=local|remote
  STOP_MOTION_STATION_URL=http://localhost:4173
  STOP_MOTION_STATION_REMOTE_URL=https://wmacfarl.github.io/stop-motion-station/
HELP_EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "${RUN_MODE}" != "local" && "${RUN_MODE}" != "remote" ]]; then
  echo "STOP_MOTION_STATION_RUN_MODE must be 'local' or 'remote'." >&2
  exit 1
fi

if ! command -v "${CHROMIUM_BINARY}" >/dev/null 2>&1; then
  if command -v chromium >/dev/null 2>&1; then
    CHROMIUM_BINARY="chromium"
  else
    echo "Chromium was not found. Install chromium-browser or chromium before launching kiosk mode." >&2
    exit 1
  fi
fi

mkdir -p "${CHROMIUM_PROFILE_DIRECTORY}"

if [[ "${RUN_MODE}" == "local" ]]; then
  APPLICATION_URL="${LOCAL_APPLICATION_URL}"
  cd "${REPOSITORY_ROOT}"

  python3 -m http.server "${APPLICATION_PORT}" --bind 127.0.0.1 &
  STATIC_SERVER_PROCESS_IDENTIFIER="$!"
else
  APPLICATION_URL="${REMOTE_APPLICATION_URL}"
fi

cleanup() {
  if [[ -n "${STATIC_SERVER_PROCESS_IDENTIFIER}" ]]; then
    kill "${STATIC_SERVER_PROCESS_IDENTIFIER}" >/dev/null 2>&1 || true
  fi
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
