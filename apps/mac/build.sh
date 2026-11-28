#!/bin/bash
# Builds HissyPad.app into apps/mac/build: the web app (apps/web/dist) inside a small Swift
# shell, signed ad hoc, so it runs on this Mac only.
#
#   apps/mac/build.sh             build
#   apps/mac/build.sh --install   build, then copy to /Applications and open it
#   apps/mac/build.sh --no-web    reuse apps/web/dist as it is
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
app="$here/build/HissyPad.app"
install=0
web=1
for arg in "$@"; do
  case "$arg" in
    --install) install=1 ;;
    --no-web) web=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$web" = 1 ]; then
  (cd "$repo" && pnpm --filter @hissypad/web build)
fi
[ -f "$repo/apps/web/dist/files.json" ] || { echo "apps/web/dist has no files.json: build the web app first" >&2; exit 1; }

(cd "$here" && swift build -c release)

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$here/Info.plist" "$app/Contents/Info.plist"
cp "$here/.build/release/HissyPad" "$app/Contents/MacOS/HissyPad"
cp -R "$repo/apps/web/dist" "$app/Contents/Resources/web"
# The service worker's files are for browsers.
rm -f "$app/Contents/Resources/web/sw.js" "$app/Contents/Resources/web"/workbox-*.js "$app/Contents/Resources/web/registerSW.js"

# The icon: the web app's 512px one on the rounded tile macOS icons sit on.
icons="$here/build/AppIcon.iconset"
rm -rf "$icons"
mkdir -p "$icons"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$repo/apps/web/public/icons/icon-512.png" --out "$icons/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  [ "$double" -le 512 ] && sips -z "$double" "$double" "$repo/apps/web/public/icons/icon-512.png" --out "$icons/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$icons" -o "$app/Contents/Resources/AppIcon.icns"
rm -rf "$icons"

codesign --force --sign - "$app" >/dev/null 2>&1
echo "Built $app"

if [ "$install" = 1 ]; then
  osascript -e 'tell application id "ph.marcelo.hissypad.mac" to quit' >/dev/null 2>&1 || true
  rm -rf /Applications/HissyPad.app
  cp -R "$app" /Applications/HissyPad.app
  open /Applications/HissyPad.app
  echo "Installed /Applications/HissyPad.app"
fi
