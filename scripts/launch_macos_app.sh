#!/bin/bash
set -euo pipefail

APP_NAME="CV Builder"
ROOT="${CV_BUILDER_ROOT:-}"
if [ -z "$ROOT" ]; then ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"; fi

STATE_DIR="${HOME}/.cv-builder"
LOG_DIR="${STATE_DIR}/logs"
LAUNCH_LOG="${LOG_DIR}/app-launcher.log"
mkdir -p "$LOG_DIR"

alert_error() {
  CV_BUILDER_MESSAGE="$1" /usr/bin/osascript >/dev/null 2>&1 <<'OSA' || true
display dialog (system attribute "CV_BUILDER_MESSAGE") buttons {"OK"} default button "OK" with title "CV Builder" with icon stop
OSA
}

if [ ! -f "${ROOT}/start.command" ] || [ ! -f "${ROOT}/package.json" ]; then
  alert_error "${APP_NAME} could not find its project folder at:\n${ROOT}\n\nKeep the app beside the project, or rebuild it with npm run macos-app."
  exit 1
fi

# AppleScript apps receive a sparse PATH. Restore the same login-shell PATH used
# when start.command is double-clicked in Terminal, then delegate all behavior to it.
LOGIN_PATH="$(${SHELL:-/bin/zsh} -lc 'printf "%s" "$PATH"' 2>/dev/null || true)"
if [ -n "$LOGIN_PATH" ]; then export PATH="${LOGIN_PATH}:/opt/homebrew/bin:/usr/local/bin"; fi

chmod +x "${ROOT}/start.command"
printf '%s launching %s through start.command\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$APP_NAME" >> "$LAUNCH_LOG"
cd "$ROOT"
exec "${ROOT}/start.command" >> "$LAUNCH_LOG" 2>&1
