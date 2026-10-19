# Builds and signs the Orca'JP package on Windows. Run by scripts/xbox-build.sh over SSH, from a
# copy laid out as the repo (xbox\Orca\ and dist\). Output: xbox\out\
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# A local self-signed certificate; its subject is the Publisher in Package.appxmanifest. It never
# leaves this machine and is not in the repo.
$pfx = 'C:\orca-build\orca-dev.pfx'
$password = ConvertTo-SecureString -String 'orca-dev' -Force -AsPlainText
if (-not (Test-Path $pfx)) {
    $cert = New-SelfSignedCertificate -Type Custom -Subject 'CN=OrcaJP Dev' -KeyUsage DigitalSignature `
        -FriendlyName 'Orca''JP dev signing' -CertStoreLocation 'Cert:\CurrentUser\My' `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
    Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $password | Out-Null
    # Trusted here so the package installs on this Windows for testing.
    Import-PfxCertificate -FilePath $pfx -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' -Password $password | Out-Null
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
if (-not $msbuild) { throw 'MSBuild not found: install the Visual Studio Build Tools with the UWP workload' }

# Every build gets its own revision (minutes since 2026, wrapping at 65536): Windows and the Xbox
# refuse a package whose version is already installed with other contents. This is the copy on
# the VM, so the repo's manifest stays at .0.
$manifest = Join-Path $here 'Orca\Package.appxmanifest'
$revision = [int][Math]::Floor(((Get-Date) - [datetime]'2026-01-01').TotalMinutes) % 65536
(Get-Content $manifest -Raw) -replace '(<Identity [^>]*Version="\d+\.\d+\.\d+)\.\d+"', "`$1.$revision`"" |
    Set-Content $manifest -NoNewline

$out = Join-Path $here 'out'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }

& $msbuild (Join-Path $here 'Orca\Orca.csproj') /restore /m /nologo /verbosity:minimal `
    /p:Configuration=Release /p:Platform=x64 `
    /p:UapAppxPackageBuildMode=SideloadOnly /p:AppxBundle=Always /p:AppxBundlePlatforms=x64 `
    /p:PackageCertificateKeyFile=$pfx /p:PackageCertificatePassword=orca-dev `
    "/p:AppxPackageDir=$out\"
if ($LASTEXITCODE -ne 0) { throw "MSBuild failed ($LASTEXITCODE)" }
Get-ChildItem -Recurse $out -Include *.msixbundle, *.appxbundle, *.appx, *.msix | Select-Object -ExpandProperty FullName
