#!/usr/bin/env bash
set -euo pipefail

if command -v readlink >/dev/null 2>&1 && readlink -f "${BASH_SOURCE[0]}" >/dev/null 2>&1; then
  SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
else
  SCRIPT_PATH="${BASH_SOURCE[0]}"
fi
APP_DIR="$(cd "$(dirname "${SCRIPT_PATH}")" && pwd)"
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

PYTHON="${ONYXTUBE_PYTHON:-python3}"
if [[ "$(uname -s)" == "Linux" ]]; then
  if ! "$PYTHON" -c "import gi" >/dev/null 2>&1; then
    if /usr/bin/python3 -c "import gi" >/dev/null 2>&1; then
      PYTHON=/usr/bin/python3
    fi
  fi
fi

exec "$PYTHON" "${APP_DIR}/desktop.py" "$@"
