#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
APP_NAME="CV Builder"
APP_PATH="${ROOT}/${APP_NAME}.app"
CONTENTS_DIR="${APP_PATH}/Contents"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
ICONSET_DIR="${RESOURCES_DIR}/AppIcon.iconset"

if [ "$(uname -s)" != "Darwin" ]; then echo "error: the macOS app shortcut can only be built on macOS" >&2; exit 1; fi
for command_name in osacompile sips iconutil; do
  if ! command -v "$command_name" >/dev/null 2>&1; then echo "error: ${command_name} is required" >&2; exit 1; fi
done

rm -rf "$APP_PATH"
chmod +x "${ROOT}/scripts/launch_macos_app.sh"

ESCAPED_ROOT="${ROOT//\\/\\\\}"
ESCAPED_ROOT="${ESCAPED_ROOT//\"/\\\"}"
APPLESCRIPT_FILE="$(mktemp)"
trap 'rm -f "$APPLESCRIPT_FILE"' EXIT
cat > "$APPLESCRIPT_FILE" <<APPLESCRIPT
set projectRoot to "${ESCAPED_ROOT}"
set launcherScript to projectRoot & "/scripts/launch_macos_app.sh"
set envPrefix to "CV_BUILDER_ROOT=" & quoted form of projectRoot & " "
set portValue to system attribute "CV_BUILDER_PORT"
if portValue is not "" then set envPrefix to envPrefix & "CV_BUILDER_PORT=" & quoted form of portValue & " "
do shell script envPrefix & quoted form of launcherScript & " >/dev/null 2>&1 &"
APPLESCRIPT
/usr/bin/osacompile -o "$APP_PATH" "$APPLESCRIPT_FILE"

/usr/bin/plutil -replace CFBundleDisplayName -string "$APP_NAME" "${CONTENTS_DIR}/Info.plist"
/usr/bin/plutil -replace CFBundleIconFile -string "AppIcon" "${CONTENTS_DIR}/Info.plist"
/usr/bin/plutil -replace CFBundleIdentifier -string "local.cv-builder.launcher" "${CONTENTS_DIR}/Info.plist"
/usr/bin/plutil -replace CFBundleName -string "$APP_NAME" "${CONTENTS_DIR}/Info.plist"
/usr/bin/plutil -replace CFBundleShortVersionString -string "1.0" "${CONTENTS_DIR}/Info.plist"
/usr/bin/plutil -replace CFBundleVersion -string "1" "${CONTENTS_DIR}/Info.plist"
/usr/bin/plutil -replace LSMinimumSystemVersion -string "10.13" "${CONTENTS_DIR}/Info.plist"
/usr/bin/plutil -replace NSHighResolutionCapable -bool YES "${CONTENTS_DIR}/Info.plist"
for key in \
  CFBundleIconName \
  NSAppleEventsUsageDescription \
  NSAppleMusicUsageDescription \
  NSCalendarsUsageDescription \
  NSCameraUsageDescription \
  NSContactsUsageDescription \
  NSHomeKitUsageDescription \
  NSMicrophoneUsageDescription \
  NSPhotoLibraryUsageDescription \
  NSRemindersUsageDescription \
  NSSiriUsageDescription \
  NSSystemAdministrationUsageDescription; do
  /usr/bin/plutil -remove "$key" "${CONTENTS_DIR}/Info.plist" 2>/dev/null || true
done

mkdir -p "$RESOURCES_DIR" "$ICONSET_DIR"
cp "${ROOT}/resources/AppIcon.svg" "${RESOURCES_DIR}/AppIcon.svg"
for spec in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" "512 512x512" "1024 512x512@2x"; do
  set -- $spec
  /usr/bin/sips -s format png -z "$1" "$1" "${ROOT}/resources/AppIcon.svg" --out "${ICONSET_DIR}/icon_$2.png" >/dev/null
done
/usr/bin/iconutil -c icns "$ICONSET_DIR" -o "${RESOURCES_DIR}/AppIcon.icns"
rm -rf "$ICONSET_DIR"
/usr/bin/touch "$APP_PATH"
if command -v codesign >/dev/null 2>&1; then /usr/bin/codesign --force --deep --sign - "$APP_PATH" >/dev/null 2>&1 || true; fi

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then "$LSREGISTER" -f "$APP_PATH" >/dev/null 2>&1 || true; fi

printf 'Created %s\n' "$APP_PATH"
