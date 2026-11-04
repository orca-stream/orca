#!/usr/bin/env bash
# Builds the site, copies it with the UWP project to the Windows VM and builds the signed package
# there (xbox/build.ps1), then brings the package back to xbox/out/. The VM needs OpenSSH and the
# Visual Studio Build Tools with the UWP workload. With --install it also installs and opens the
# app on the VM's desktop, to try it there.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
vm="${XBOX_BUILD_HOST:?Set XBOX_BUILD_HOST=<user>@<windows-host>}"
remote='C:/orca-build/src'

cd "$root"
pnpm build
ssh "$vm" "powershell -NoProfile -Command \"if (Test-Path $remote) { Remove-Item -Recurse -Force $remote }; New-Item -ItemType Directory -Force $remote | Out-Null\""
# Same layout as the repo: the project finds the site at ../../dist.
ssh "$vm" "powershell -NoProfile -Command \"New-Item -ItemType Directory -Force $remote/xbox | Out-Null\""
scp -q -r xbox/Orca xbox/build.ps1 xbox/install.ps1 "$vm:$remote/xbox/"
scp -q -r dist "$vm:$remote/"
ssh "$vm" "powershell -NoProfile -ExecutionPolicy Bypass -File $remote/xbox/build.ps1"
rm -rf xbox/out
scp -q -r "$vm:$remote/xbox/out" xbox/out
find xbox/out -name '*.msixbundle' -o -name '*.appxbundle' | head -1

if [[ "${1:-}" == "--install" ]]; then
  # Runs in the signed-in user's session: installing from SSH is denied.
  ssh "$vm" "powershell -NoProfile -Command \"\$a = New-ScheduledTaskAction -Execute powershell.exe -Argument '-NoProfile -ExecutionPolicy Bypass -File $remote/xbox/install.ps1'; \$p = New-ScheduledTaskPrincipal -UserId \$env:USERNAME -LogonType Interactive; Register-ScheduledTask -TaskName OrcaInstall -Action \$a -Principal \$p -Force | Out-Null; Start-ScheduledTask OrcaInstall; do { Start-Sleep 2 } while ((Get-ScheduledTask OrcaInstall).State -eq 'Running'); Get-Content $remote/xbox/install.log\""
fi
