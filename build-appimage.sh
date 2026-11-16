#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${APP_DIR}/dist"
APPDIR="${DIST_DIR}/OnyxTube.AppDir"
OUT_APPIMAGE="${DIST_DIR}/OnyxTube-x86_64.AppImage"

rm -rf "${APPDIR}"
mkdir -p "${APPDIR}/usr/bin" "${APPDIR}/usr/share/onyxtube" "${APPDIR}/usr/share/icons/hicolor/scalable/apps"

if python3 -m PyInstaller --version >/dev/null 2>&1; then
  echo "[1/3] Building standalone binary with PyInstaller..."
  python3 -m PyInstaller --noconfirm --clean \
    --name onyxtube \
    --onedir \
    --windowed \
    --distpath "${DIST_DIR}/pyi" \
    --workpath "${DIST_DIR}/work" \
    --specpath "${DIST_DIR}" \
    --add-data "${APP_DIR}/index.html:." \
    --add-data "${APP_DIR}/app.js:." \
    --add-data "${APP_DIR}/styles.css:." \
    --add-data "${APP_DIR}/tokens.css:." \
    --add-data "${APP_DIR}/onyxtube.svg:." \
    --hidden-import gi \
    --hidden-import yt_dlp \
    "${APP_DIR}/desktop.py"
  cp -a "${DIST_DIR}/pyi/onyxtube/"* "${APPDIR}/usr/bin/"
  EXEC_REL="usr/bin/onyxtube"
else
  echo "[1/3] PyInstaller not found, packaging portable Python AppDir..."
  cp "${APP_DIR}/desktop.py" "${APP_DIR}/server.py" "${APP_DIR}/index.html" "${APP_DIR}/app.js" "${APP_DIR}/styles.css" "${APP_DIR}/tokens.css" "${APP_DIR}/onyxtube.svg" "${APPDIR}/usr/share/onyxtube/"
  EXEC_REL="usr/share/onyxtube/desktop.py"
fi

echo "[2/3] Creating AppDir metadata and AppRun..."
cp "${APP_DIR}/onyxtube.svg" "${APPDIR}/onyxtube.svg"
cp "${APP_DIR}/onyxtube.svg" "${APPDIR}/.DirIcon"
cp "${APP_DIR}/onyxtube.svg" "${APPDIR}/usr/share/icons/hicolor/scalable/apps/onyxtube.svg"

cat > "${APPDIR}/onyxtube.desktop" <<'DESKTOP'
[Desktop Entry]
Name=OnyxTube
Comment=Privacy-Focused Desktop YouTube Client
Exec=onyxtube
Icon=onyxtube
Terminal=false
Type=Application
Categories=AudioVideo;
StartupWMClass=OnyxTube
DESKTOP

cat > "${APPDIR}/AppRun" <<APPRUN
#!/usr/bin/env bash
HERE="\$(dirname "\$(readlink -f "\$0")")"
export PATH="\${HERE}/usr/bin:\${HOME}/.local/bin:\${PATH}"
if [[ -x "\${HERE}/usr/bin/onyxtube" ]]; then
  exec "\${HERE}/usr/bin/onyxtube" "\$@"
fi
PY_BIN="\$(command -v python3 || true)"
if [[ -z "\${PY_BIN}" ]] || ! "\${PY_BIN}" -c "import gi" >/dev/null 2>&1; then
  if [[ -x /usr/bin/python3 ]] && /usr/bin/python3 -c "import gi" >/dev/null 2>&1; then
    PY_BIN="/usr/bin/python3"
  fi
fi
exec "\${PY_BIN:-python3}" "\${HERE}/${EXEC_REL}" "\$@"
APPRUN
chmod +x "${APPDIR}/AppRun"

echo "[3/3] Packaging AppImage..."
APPIMAGETOOL="${APPIMAGETOOL:-$(command -v appimagetool || true)}"
if [[ -z "${APPIMAGETOOL}" ]]; then
  APPIMAGETOOL="${DIST_DIR}/appimagetool-x86_64.AppImage"
  if [[ ! -x "${APPIMAGETOOL}" ]]; then
    curl -fsSL -o "${APPIMAGETOOL}" "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x "${APPIMAGETOOL}"
  fi
fi

ARCH=x86_64 "${APPIMAGETOOL}" --appimage-extract-and-run "${APPDIR}" "${OUT_APPIMAGE}"
echo "Built AppImage: ${OUT_APPIMAGE}"
