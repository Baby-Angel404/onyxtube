#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
APPS_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/scalable/apps"

PYTHON="${ONYXTUBE_PYTHON:-python3}"
if ! "$PYTHON" -c "import gi" >/dev/null 2>&1; then
  if /usr/bin/python3 -c "import gi" >/dev/null 2>&1; then
    PYTHON=/usr/bin/python3
  else
    echo "ERROR: modul Python 'gi' (PyGObject) tidak ditemukan." >&2
    exit 1
  fi
fi

chmod +x "${APP_DIR}/server.py" "${APP_DIR}/desktop.py" "${APP_DIR}/launch-onyxtube.sh"
mkdir -p "${BIN_DIR}" "${APPS_DIR}" "${ICON_DIR}"

ln -sf "${APP_DIR}/launch-onyxtube.sh" "${BIN_DIR}/onyxtube"
cp "${APP_DIR}/onyxtube.svg" "${ICON_DIR}/onyxtube.svg"

cat > "${APPS_DIR}/onyxtube.desktop" <<DESKTOP
[Desktop Entry]
Name=OnyxTube
Comment=Native Desktop Media Client
Exec=${BIN_DIR}/onyxtube
Icon=onyxtube
Terminal=false
Type=Application
Categories=AudioVideo;Video;Network;
StartupWMClass=OnyxTube
DESKTOP

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${APPS_DIR}" || true
fi

echo "Installed OnyxTube native desktop launcher to ${BIN_DIR}/onyxtube and ${APPS_DIR}/onyxtube.desktop"
