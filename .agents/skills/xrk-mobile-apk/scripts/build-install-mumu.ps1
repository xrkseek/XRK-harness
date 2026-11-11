#Requires -Version 5.1
<#
.SYNOPSIS
  ASCII-copy XRK-harness-mobile → C:\xrk-mobile, build arm64 release APK (with runtime gate).

.DESCRIPTION
  One-shot build. Product path is **arm64** + complete runtime/out/arm64-v8a.
  Default is **build only** (-SkipInstall). MuMu / emulators are NOT supported
  (cannot run arm proot guest). Hand-test on a real arm64 device with -Install.
  See ../SKILL.md and ../../xrk-dev-surfaces/SKILL.md.
  Does NOT sync XRK-harness client into guest xrkh runtime.

.PARAMETER SkipBuild
  Use an existing staged APK (with -Install).

.PARAMETER SkipInstall
  Build only; do not adb install. **Default when -Install is omitted.**

.PARAMETER Install
  After build, adb install -r onto a **real** device serial (-Serial). Not MuMu.

.PARAMETER Flavor
  Gradle/Flutter flavor: arm64 (default, product) or x64 (explicit special-case).

.PARAMETER Apk
  Explicit APK path for install.

.PARAMETER Serial
  adb serial for -Install (real device). MuMu ports are refused.

.PARAMETER Source
  Mobile repo working tree (Unicode path OK — we only robocopy FROM it).

.PARAMETER ClearData
  After -Install, pm clear so first-run onboarding is fresh.
#>
[CmdletBinding()]
param(
  [switch] $SkipBuild,
  [switch] $SkipInstall,
  [switch] $Install,
  [ValidateSet('arm64', 'x64')]
  [string] $Flavor = 'arm64',
  [string] $Apk = '',
  [string] $Serial = '',
  [string] $Source = 'C:\Users\xrkseek\Desktop\主仓库\XRK-harness-mobile',
  [string] $AsciiRoot = 'C:\xrk-mobile',
  [switch] $ClearData
)

$ErrorActionPreference = 'Stop'

function Die([string] $msg) {
  Write-Host "build-install-mumu: $msg" -ForegroundColor Red
  exit 1
}

# Default: only produce APK. Never auto-target MuMu.
if (-not $Install) { $SkipInstall = $true }
if ($Install -and $PSBoundParameters.ContainsKey('SkipInstall') -and $SkipInstall) {
  Die 'pass -Install or omit it for build-only; do not combine with -SkipInstall'
}

function Find-Adb {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'),
    'C:\Program Files\Netease\MuMu\nx_main\adb.exe'
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return $c }
  }
  $where = & where.exe adb 2>$null | Select-Object -First 1
  if ($where) { return $where }
  return $null
}

function Find-Bash {
  $p = 'C:\Program Files\Git\bin\bash.exe'
  if (Test-Path -LiteralPath $p) { return $p }
  return $null
}

function Assert-RealDeviceSerial([string] $serial) {
  if (-not $serial) { Die '-Install requires -Serial <real-device adb serial>' }
  # MuMu / common emulator endpoints — product guest needs real arm64.
  if ($serial -match '^(127\.0\.0\.1:16384|emulator-\d+)$') {
    Die "MuMu/emulator serial refused ($serial). Guest arm proot does not run there; use a real arm64 device."
  }
}

function Ensure-DeviceSerial([string] $adb, [string] $serial) {
  Assert-RealDeviceSerial $serial
  $lines = & $adb devices | Out-String
  $pat = [regex]::Escape($serial) + '\s+device'
  if ($lines -notmatch $pat) {
    Die "adb device not ready: $serial (plug in a real arm64 phone and enable USB debugging)"
  }
}

function RuntimeAbiDir([string] $flavor) {
  switch ($flavor) {
    'arm64' { return 'arm64-v8a' }
    'x64' { return 'x86_64' }
    default { Die "unknown flavor $flavor" }
  }
}

function Assert-RuntimeComplete([string] $mobileRoot, [string] $flavor) {
  $abi = RuntimeAbiDir $flavor
  $base = Join-Path $mobileRoot "runtime\out\$abi\assets\runtime"
  $manifest = Join-Path $base 'manifest.json'
  $rootfsName = if ($abi -eq 'arm64-v8a') { 'rootfs-arm64-v8a.tar.xz' } else { 'rootfs-x86_64.tar.xz' }
  $rootfs = Join-Path $base $rootfsName
  $jni = Join-Path $mobileRoot "runtime\out\$abi\jniLibs\$abi\libproot.so"

  if (-not (Test-Path -LiteralPath $manifest)) {
    Die @"
missing $manifest
Gradle flavor '$flavor' packs ONLY runtime/out/$abi/.
Build on Linux (AGT): runtime/build-runtime.sh $abi
Pull to phone repo runtime/out/$abi/ then re-run.
See skill xrk-dev-surfaces §面 C · mobile docs/HANDOFF.md
"@
  }
  if (-not (Test-Path -LiteralPath $rootfs)) {
    Die "missing rootfs: $rootfs"
  }
  $bytes = (Get-Item -LiteralPath $rootfs).Length
  # Complete r17 archives are ~100MB+; incomplete pulls were ~20–86MB and still
  # passed a naive size floor — always verify against manifest.rootfsBytes/sha256.
  if ($bytes -lt 80MB) {
    Die "rootfs too small ($bytes bytes) at $rootfs — incomplete pull/build. Need full AGT out/$abi."
  }
  if (-not (Test-Path -LiteralPath $jni)) {
    Die "missing jni libproot: $jni"
  }
  try {
    $man = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $ver = $man.runtimeVersion
  } catch {
    Die "manifest.json unreadable: $manifest"
  }
  if ($null -ne $man.rootfsBytes) {
    $expectBytes = [int64]$man.rootfsBytes
    if ($bytes -ne $expectBytes) {
      Die "rootfs size $bytes != manifest.rootfsBytes $expectBytes at $rootfs — truncated/corrupt pull. Re-pull AGT out/$abi."
    }
  }
  if ($man.rootfsSha256) {
    $actualSha = (Get-FileHash -LiteralPath $rootfs -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectSha = [string]$man.rootfsSha256
    if ($actualSha -ne $expectSha.ToLowerInvariant()) {
      Die "rootfs sha256 mismatch (got $actualSha, expect $expectSha) — device install would fail verify. Re-pull AGT out/$abi."
    }
  }
  Write-Host "→ runtime OK: $abi · $ver · rootfs $([math]::Round($bytes/1MB,1)) MB · sha ok" -ForegroundColor Green
}

if (-not (Test-Path -LiteralPath $Source)) {
  Die "source mobile tree missing: $Source"
}

$adb = $null
if ($Install) {
  $adb = Find-Adb
  if (-not $adb) { Die 'adb.exe not found (Android SDK platform-tools)' }
}
$bash = Find-Bash
if (-not $SkipBuild -and -not $bash) { Die 'Git Bash not found at C:\Program Files\Git\bin\bash.exe' }

$env:ANDROID_HOME = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$flutterBin = 'C:\tools\flutter\bin'
if (Test-Path $flutterBin) {
  $env:Path = "$flutterBin;$env:ANDROID_HOME\platform-tools;$env:Path"
}

$abi = RuntimeAbiDir $Flavor

if (-not $SkipBuild) {
  # Gate on SOURCE first so we fail before a long robocopy if runtime missing.
  Assert-RuntimeComplete -mobileRoot $Source -flavor $Flavor

  Write-Host "→ robocopy $Source → $AsciiRoot (ASCII build tree)" -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $AsciiRoot | Out-Null
  $xd = @('.git', '.tmp', 'node_modules', '.dart_tool', 'build')
  & robocopy.exe $Source $AsciiRoot /MIR /XD $xd /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  $rc = $LASTEXITCODE
  if ($rc -ge 8) { Die "robocopy failed with exit $rc" }

  if (-not (Test-Path -LiteralPath (Join-Path $AsciiRoot 'tooling\build-apk.sh'))) {
    Die "after copy, tooling/build-apk.sh missing under $AsciiRoot"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $AsciiRoot 'app\pubspec.yaml'))) {
    Die "after copy, app/pubspec.yaml missing — source tree incomplete?"
  }

  # Gate again on ASCII tree (must have mirrored runtime/out).
  Assert-RuntimeComplete -mobileRoot $AsciiRoot -flavor $Flavor

  Write-Host "→ tooling/build-apk.sh -f $Flavor (release) under $AsciiRoot [FOREGROUND]" -ForegroundColor Cyan
  if ($AsciiRoot -notmatch '^([A-Za-z]):\\(.*)$') { Die "AsciiRoot must be like C:\xrk-mobile, got: $AsciiRoot" }
  $bashRoot = '/' + $Matches[1].ToLower() + '/' + ($Matches[2] -replace '\\', '/')
  & $bash -lc "cd '$bashRoot' && tooling/build-apk.sh -f $Flavor"
  if ($LASTEXITCODE -ne 0) { Die "build-apk.sh failed (exit $LASTEXITCODE)" }

  $built = Join-Path $AsciiRoot "app\build\app\outputs\flutter-apk\app-$Flavor-release.apk"
  if (-not (Test-Path -LiteralPath $built)) { Die "APK not produced: $built" }

  # Refuse empty-runtime APKs (no assets/runtime in zip).
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($built)
  try {
    $hasManifest = $zip.Entries | Where-Object { $_.FullName -eq 'assets/runtime/manifest.json' } | Select-Object -First 1
    $hasRootfs = $zip.Entries | Where-Object { $_.FullName -like 'assets/runtime/rootfs-*.tar.xz' -and $_.Length -gt 80MB } | Select-Object -First 1
  } finally {
    $zip.Dispose()
  }
  if (-not $hasManifest -or -not $hasRootfs) {
    Die "built APK missing assets/runtime (manifest/rootfs). Flavor=$Flavor abi=$abi — check Gradle sourceSets → runtime/out/$abi"
  }

  $outDir = Join-Path $AsciiRoot 'out'
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $verLine = Get-Content (Join-Path $AsciiRoot 'app\pubspec.yaml') | Where-Object { $_ -match '^version:\s*([^\+]+)' } | Select-Object -First 1
  $ver = if ($verLine -match '^version:\s*([^\+\s]+)') { $Matches[1] } else { '0.0.0' }
  $staged = Join-Path $outDir "xrk-harness-$ver-$Flavor-release.apk"
  Copy-Item -LiteralPath $built -Destination $staged -Force
  Write-Host "→ staged $staged" -ForegroundColor Green
  if (-not $Apk) { $Apk = $staged }
}

if (-not $Apk) {
  $fallback = Get-ChildItem (Join-Path $AsciiRoot "out\xrk-harness-*-$Flavor-release.apk") -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($fallback) { $Apk = $fallback.FullName }
}
if (-not $Apk -or -not (Test-Path -LiteralPath $Apk)) {
  Die "no APK to install (pass -Apk or drop SkipBuild)"
}

if ($SkipInstall) {
  Write-Host "STATUS=DONE_OK" -ForegroundColor Green
  Write-Host "SkipInstall: APK at $Apk" -ForegroundColor Yellow
  exit 0
}

Ensure-DeviceSerial $adb $Serial
Write-Host "→ adb -s $Serial install -r $Apk" -ForegroundColor Cyan
& $adb -s $Serial install -r $Apk
if ($LASTEXITCODE -ne 0) { Die "adb install failed" }

$pkg = 'com.xrkseek.harness'
if ($ClearData) {
  Write-Host "→ pm clear $pkg (fresh first-run)" -ForegroundColor Cyan
  & $adb -s $Serial shell pm clear $pkg | Out-Host
}

Write-Host "→ launch $pkg" -ForegroundColor Cyan
& $adb -s $Serial shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 2>&1 | Out-Host

& $adb -s $Serial shell dumpsys package $pkg |
  Select-String -Pattern 'versionCode|versionName|lastUpdateTime' |
  Select-Object -First 6 |
  ForEach-Object { $_.Line.Trim() }

Write-Host "STATUS=DONE_OK" -ForegroundColor Green
Write-Host @"

OK. Installed on real device $Serial ($pkg) · flavor=$Flavor.
NOTE: Flutter shell only. Queue/steer UI needs guest xrkh runtime sync (see xrk-dev-surfaces).
"@ -ForegroundColor Green
