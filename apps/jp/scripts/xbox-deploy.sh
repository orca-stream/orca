#!/usr/bin/env bash
# Installs the last package built by `pnpm xbox:build` on an Xbox in Dev Mode through its Device
# Portal, with the frameworks it depends on, and starts it. The portal's address and the credentials
# set in Dev Home > Remote Access come from ~/.config/orca-xbox.env (never from the repo):
#   XBOX_PORTAL=https://192.168.1.x:11443  XBOX_USER=...  XBOX_PASS=...
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${XBOX_ENV:-$HOME/.config/orca-xbox.env}"

bundle="$(find "$root/xbox/out" -name '*.msixbundle' | head -1)"
[[ -n "$bundle" ]] || { echo "No package in xbox/out: run pnpm xbox:build first" >&2; exit 1; }
deps_dir="$(dirname "$bundle")/Dependencies/x64"

jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT
# The portal's certificate is self-signed; it is a device on the home network.
portal() { curl -sSk -u "$XBOX_USER:$XBOX_PASS" -b "$jar" -c "$jar" "$@"; }
# POSTs need the CSRF token the portal sets as a cookie on any GET.
portal -o /dev/null "$XBOX_PORTAL/api/os/info"
csrf="$(awk '$6 == "CSRF-Token" { print $7 }' "$jar")"
post() { portal -H "X-CSRF-Token: $csrf" -X POST "$@"; }

name="$(basename "$bundle")"
args=(-F "$name=@$bundle")
for dep in "$deps_dir"/*.appx; do args+=(-F "$(basename "$dep")=@$dep"); done
echo "Uploading $name and $(ls "$deps_dir"/*.appx | wc -l) dependencies to $XBOX_PORTAL"
post --fail-with-body "${args[@]}" "$XBOX_PORTAL/api/app/packagemanager/package?package=$name" >/dev/null

# 204 while the install runs; 200 with the outcome when it ends.
while :; do
  sleep 2
  status="$(portal -o "$jar.state" -w '%{http_code}' "$XBOX_PORTAL/api/app/packagemanager/state")"
  [[ "$status" == 204 ]] && continue
  cat "$jar.state"; echo
  rm -f "$jar.state"
  [[ "$status" == 200 ]] || exit 1
  break
done

# The bundle's name carries the version just installed (Orca_0.1.0.N_x64.msixbundle).
version="$(sed -E 's/^Orca_([0-9.]+)_.*/\1/' <<<"$name")"
read -r full app < <(portal "$XBOX_PORTAL/api/app/packagemanager/packages" |
  python3 -c 'import json, sys
for p in json.load(sys.stdin)["InstalledPackages"]:
    if p["PackageFullName"].startswith("io.github.orcastream.orca_" + sys.argv[1] + "_"):
        print(p["PackageFullName"], p["PackageRelativeId"]); break' "$version")
[[ -n "$full" ]] || { echo "Version $version is not among the installed packages" >&2; exit 1; }
echo "Installed $full; starting it"
# appid is the package-relative id (family!App), not the manifest's bare "App"; launching also needs
# someone signed in on the console.
b64() { printf '%s' "$1" | base64 -w0; }
post --fail-with-body -H "Content-Length: 0" \
  "$XBOX_PORTAL/api/taskmanager/app?appid=$(b64 "$app")&package=$(b64 "$full")" >/dev/null
