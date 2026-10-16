# Installs the freshly built package on this Windows and opens it. App packages cannot be installed
# from an SSH session (access denied), so scripts/xbox-build.sh --install runs this as a scheduled
# task in the signed-in user's desktop session.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'install.log'
try {
    $dir = Get-ChildItem (Join-Path $here 'out') -Directory | Select-Object -First 1
    $bundle = Get-ChildItem $dir.FullName -Filter *.msixbundle | Select-Object -First 1
    $deps = @(Get-ChildItem (Join-Path $dir.FullName 'Dependencies\x64') -Filter *.appx | ForEach-Object FullName)
    Add-AppxPackage -Path $bundle.FullName -DependencyPath $deps -ForceUpdateFromAnyVersion -ForceApplicationShutdown
    $family = (Get-AppxPackage io.github.orcastream.orca).PackageFamilyName
    Start-Process "shell:AppsFolder\$family!App"
    "installed $family" | Out-File $log
} catch {
    "failed: $($_.Exception.Message)" | Out-File $log
}
