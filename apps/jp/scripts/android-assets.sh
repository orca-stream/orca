#!/usr/bin/env bash
# Renders the Android launcher icons, the Android TV banner and the splash screens from the brand
# SVGs in resources/. Needs ImageMagick (`convert`). Run it again whenever the brand changes.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
brand="$root/resources"
res="$root/android/app/src/main/res"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# render <svg> <svg width> <width> <out>: rasterises at twice the target size, then scales down.
render() {
  local density=$((72 * $3 * 2 / $2))
  convert -background none -density "$density" "$1" -resize "$3x" "$4"
}

# The adaptive icon's foreground is the mark without its black square (the background layer is
# black already). Launchers show only the middle 72dp of the 108dp layer, so the artboard is drawn at
# 64% of the layer: the mark ends up about half the visible icon tall, the size of Netflix's N.
grep -v "<rect" "$brand/icon.svg" > "$tmp/mark.svg"

for pair in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  density="${pair%%:*}"
  scale="${pair##*:}"
  icon=$(awk "BEGIN { print int(48 * $scale) }")
  layer=$(awk "BEGIN { print int(108 * $scale) }")
  dir="$res/mipmap-$density"

  render "$brand/icon.svg" 256 "$icon" "$dir/ic_launcher.png"
  convert "$dir/ic_launcher.png" \
    \( -size "${icon}x${icon}" xc:none -fill white -draw "circle $((icon / 2)),$((icon / 2)) $((icon / 2)),0" \) \
    -compose DstIn -composite "$dir/ic_launcher_round.png"
  render "$tmp/mark.svg" 256 $((layer * 64 / 100)) "$tmp/mark.png"
  convert "$tmp/mark.png" -background none -gravity center -extent "${layer}x${layer}" \
    "$dir/ic_launcher_foreground.png"
done

# Android TV launcher banner: 320x180 at xhdpi, the logotype centred on black.
render "$brand/logotype.svg" 949 224 "$tmp/banner-logo.png"
convert -size 320x180 xc:black "$tmp/banner-logo.png" -gravity center -composite "$res/drawable-xhdpi/banner.png"

# Splash screens: the logotype at half the short side, centred on black, for every size Capacitor made.
find "$res" -name splash.png | while read -r splash; do
  size=$(identify -format "%w %h" "$splash")
  w=${size% *}
  h=${size#* }
  short=$((w < h ? w : h))
  render "$brand/logotype.svg" 949 $((short / 2)) "$tmp/splash-logo.png"
  convert -size "${w}x${h}" xc:black "$tmp/splash-logo.png" -gravity center -composite "$splash"
done

echo "Android assets rendered from $brand"
