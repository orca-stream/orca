#!/usr/bin/env bash
# Builds the app's flat APT repository around one .deb: the package beside its signed index
# (Packages, Release, InRelease, Release.gpg), ready to serve from one folder of a web server or as
# the assets of one GitHub release. Only the newest version is listed: that is all apt needs.
#
#   scripts/apt-repo.sh <package.deb> <out-dir>
#
# Signs with APT_SIGNING_KEY_ID (a fingerprint in the current GnuPG home) — the key whose public
# half the .deb carries (HM_APT_KEY_FILE). Needs apt-ftparchive (apt-utils) and gpg.
set -euo pipefail

deb=${1:?usage: apt-repo.sh <package.deb> <out-dir>}
out=${2:?usage: apt-repo.sh <package.deb> <out-dir>}
key=${APT_SIGNING_KEY_ID:?set APT_SIGNING_KEY_ID to the signing key fingerprint}

mkdir -p "$out"
out=$(cd "$out" && pwd)
cp "$deb" "$out/"
cd "$out"

apt-ftparchive packages . > Packages
gzip -9 --keep --force Packages
# Written aside first: a Release created in the folder would list itself.
release=$(mktemp)
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=orca-hm \
  -o APT::FTPArchive::Release::Label=orca-hm \
  -o "APT::FTPArchive::Release::Description=Orca'H&M desktop app" \
  release . > "$release"
mv "$release" Release
chmod 644 Release
gpg --batch --yes --local-user "$key" --clearsign --output InRelease Release
gpg --batch --yes --local-user "$key" --armor --detach-sign --output Release.gpg Release

echo "APT repository in $out:"
ls -1
