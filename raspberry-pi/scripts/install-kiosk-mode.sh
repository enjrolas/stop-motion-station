#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIRECTORY}/../.." && pwd)"
SYSTEMD_USER_DIRECTORY="${HOME}/.config/systemd/user"
AUTOSTART_DIRECTORY="${HOME}/.config/autostart"
SERVICE_FILE_PATH="${SYSTEMD_USER_DIRECTORY}/stop-motion-station-kiosk.service"
AUTOSTART_FILE_PATH="${AUTOSTART_DIRECTORY}/stop-motion-station-kiosk.desktop"
LAUNCH_SCRIPT_PATH="${REPOSITORY_ROOT}/raspberry-pi/scripts/launch-kiosk.sh"

mkdir -p "${SYSTEMD_USER_DIRECTORY}" "${AUTOSTART_DIRECTORY}"
chmod +x "${LAUNCH_SCRIPT_PATH}"

cat > "${SERVICE_FILE_PATH}" <<SERVICE_EOF
[Unit]
Description=Stop Motion Station kiosk
After=graphical-session.target

[Service]
Type=simple
Environment=STOP_MOTION_STATION_ROOT=${REPOSITORY_ROOT}
Environment=STOP_MOTION_STATION_RUN_MODE=${STOP_MOTION_STATION_RUN_MODE:-local}
ExecStart=${LAUNCH_SCRIPT_PATH}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SERVICE_EOF

cat > "${AUTOSTART_FILE_PATH}" <<DESKTOP_EOF
[Desktop Entry]
Type=Application
Name=Stop Motion Station Kiosk
Comment=Launch Stop Motion Station in Chromium kiosk mode
Exec=systemctl --user start stop-motion-station-kiosk.service
Terminal=false
X-GNOME-Autostart-enabled=true
DESKTOP_EOF

systemctl --user daemon-reload
systemctl --user enable stop-motion-station-kiosk.service

echo "Installed Stop Motion Station kiosk service. Reboot or run this command to start it now:"
echo "systemctl --user start stop-motion-station-kiosk.service"
