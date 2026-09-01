#!/usr/bin/env bash
#
# CV Builder - one-click starter.
#   • Double-click in Finder, or run: ./start.command
#   • Installs dependencies on first run, starts the server, and opens the browser.
#   • Close the Terminal window or press Ctrl-C to stop the server.
#
set -euo pipefail

# Always run from the project directory, including when opened from Finder.
cd "$(dirname "$0")"

CV_BUILDER_PORT="${CV_BUILDER_PORT:-5173}"
export CV_BUILDER_PORT
PORT="$CV_BUILDER_PORT"
URL="http://127.0.0.1:${PORT}"

open_url() {
  if command -v open >/dev/null 2>&1 && open -Ra "Google Chrome" >/dev/null 2>&1; then
    open -na "Google Chrome" --args --new-window "$1"
    echo "Opened CV Builder in a new Google Chrome window."
  elif command -v open >/dev/null 2>&1; then open "$1"          # macOS fallback
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"  # Linux
  else echo "Open $1 in your browser."; fi
}

cv_builder_is_ready() {
  curl -fsS --max-time 2 "$URL" 2>/dev/null | grep -q '<title>CV Builder</title>'
}

if cv_builder_is_ready; then
  echo "CV Builder is already running at $URL"
  open_url "$URL"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install Node.js and try again." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install npm and try again." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies for the first run..."
  npm install
fi

(
  for _ in $(seq 1 60); do
    if cv_builder_is_ready; then
      open_url "$URL"
      exit 0
    fi
    sleep 0.5
  done
  echo "The browser did not open automatically. Open $URL manually."
) &

echo "Starting CV Builder at $URL  (press Ctrl-C to stop)"
exec npm run dev -- --host 127.0.0.1 --port "$PORT" --strictPort
