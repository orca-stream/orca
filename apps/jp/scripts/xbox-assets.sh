#!/usr/bin/env bash
# Renders the Xbox/Windows app tiles and splash screen from the brand SVGs in resources/. Needs
# ImageMagick (`convert`). Run it again whenever the brand changes.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
brand="$root/resources"
out="$root/xbox/Orca/Assets"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

# render <svg> <svg width> <width> <out>: rasterises at twice the target size, then scales down.
render() {
  local density=$((72 * $3 * 2 / $2))
  convert -background none -density "$density" "$1" -resize "$3x" "$4"
}

# Square tiles and the app list icon: the "O'" mark on its black square.
render "$brand/icon.svg" 256 150 "$out/Square150x150Logo.png"
render "$brand/icon.svg" 256 44 "$out/Square44x44Logo.png"
render "$brand/icon.svg" 256 50 "$out/StoreLogo.png"

# Wide tile (what the Xbox home shows when pinned) and the splash screen: the logotype on black.
render "$brand/logotype.svg" 949 200 "$tmp/wide-logo.png"
convert -size 310x150 xc:black "$tmp/wide-logo.png" -gravity center -composite "$out/Wide310x150Logo.png"
render "$brand/logotype.svg" 949 300 "$tmp/splash-logo.png"
convert -size 620x300 xc:black "$tmp/splash-logo.png" -gravity center -composite "$out/SplashScreen.png"
