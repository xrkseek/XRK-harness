#Requires -Version 5.1
<#
.SYNOPSIS
  Pack the **local** (possibly uncommitted) @xrkseek/harness-cli + product-web into a tarball
  for AGT `ENGINE_TGZ=` mobile runtime builds. No git commit / npm publish required.

.DESCRIPTION
  1) System Node ≥26 on PATH
  2) web:build + client:bundle + web:assemble (so product-web is current)
  3) pnpm release:stage → .release/xrkseek-harness-cli-<ver>.tgz
  4) Copy to .release/mobile-engine/ (stable hand-off folder)

  Next: upload that tgz to AGT, then:
    ENGINE_TGZ=/root/xrk-mobile/engine/xrkseek-harness-cli-<ver>.tgz \
    ENGINE_VERSION=<ver> \
    runtime/build-runtime.sh arm64-v8a

  See ../SKILL.md 「本地源码 xrkh」.

.PARAMETER SkipWeb
  Reuse existing apps/cli/product-web (faster if shell UI unchanged).
#>
[CmdletBinding()]
param(
  [switch] $SkipWeb
)

$ErrorActionPreference = 'Stop'
$HarnessRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\')).Path
Set-Location -LiteralPath $HarnessRoot

function Die([string] $msg) {
  Write-Host "pack-local-engine: $msg" -ForegroundColor Red
  exit 1
}

$pick = @(where.exe node 2>$null) | Where-Object {
  $_ -notmatch '\\cursor\\resources\\app\\resources\\helpers\\node\.exe$'
} | Select-Object -First 1
if (-not $pick) { Die 'No system Node on PATH (need ≥26)' }
$env:Path = "$(Split-Path -Parent $pick);$env:Path"
# Agent / non-TTY shells: pnpm otherwise aborts module purge prompts mid web:build.
$env:CI = 'true'
$nv = & node -v
Write-Host "pack-local-engine: node $nv" -ForegroundColor Cyan
if ($nv -notmatch '^v(2[6-9]|[3-9]\d)') { Die "Node $nv < 26" }

$cliPkg = Join-Path $HarnessRoot 'apps\cli\package.json'
$ver = (Get-Content -LiteralPath $cliPkg -Raw | ConvertFrom-Json).version
if (-not $ver) { Die 'apps/cli/package.json missing version' }

if (-not $SkipWeb) {
  Write-Host 'pack-local-engine: web:build + client:bundle + web:assemble' -ForegroundColor Cyan
  & pnpm web:build
  if ($LASTEXITCODE -ne 0) { Die "web:build exit $LASTEXITCODE" }
  & pnpm client:bundle
  if ($LASTEXITCODE -ne 0) { Die "client:bundle exit $LASTEXITCODE" }
  & pnpm web:assemble
  if ($LASTEXITCODE -ne 0) { Die "web:assemble exit $LASTEXITCODE" }
} else {
  Write-Host 'pack-local-engine: -SkipWeb (using existing product-web)' -ForegroundColor Yellow
}

Write-Host 'pack-local-engine: pnpm release:stage' -ForegroundColor Cyan
& pnpm release:stage
if ($LASTEXITCODE -ne 0) { Die "release:stage exit $LASTEXITCODE" }

$src = Join-Path $HarnessRoot ".release\xrkseek-harness-cli-$ver.tgz"
if (-not (Test-Path -LiteralPath $src)) {
  $cand = Get-ChildItem -LiteralPath (Join-Path $HarnessRoot '.release') -Filter 'xrkseek-harness-cli-*.tgz' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $cand) { Die "no xrkseek-harness-cli-*.tgz under .release after stage" }
  $src = $cand.FullName
  $ver = ($cand.BaseName -replace '^xrkseek-harness-cli-', '')
}

$destDir = Join-Path $HarnessRoot '.release\mobile-engine'
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir "xrkseek-harness-cli-$ver.tgz"
Copy-Item -LiteralPath $src -Destination $dest -Force

# Gate: mobile guest merge needs seeds/mobile/skills/xrk-phone inside the tgz.
$probe = & tar -tzf $dest 2>$null | Select-String -SimpleMatch 'seeds/mobile/skills/xrk-phone/SKILL.md' | Select-Object -First 1
if (-not $probe) {
  Die "tgz missing seeds/mobile/skills/xrk-phone/SKILL.md (stage gate should have caught this)"
}
Write-Host "pack-local-engine: seeds/mobile/xrk-phone OK in tgz" -ForegroundColor Green

# release:stage clears root devDeps — restore for continued local work
Write-Host 'pack-local-engine: CI=true pnpm install --frozen-lockfile (restore root after stage)' -ForegroundColor Cyan
$env:CI = 'true'
& pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Die "pnpm install restore exit $LASTEXITCODE" }

Write-Host ""
Write-Host "STATUS=DONE_OK" -ForegroundColor Green
Write-Host "pack-local-engine: OK"
Write-Host "  tgz: $dest"
Write-Host "  ENGINE_VERSION=$ver"
Write-Host ""
Write-Host "Next (wait for STATUS=DONE_OK on each):" -ForegroundColor Cyan
Write-Host "  python .agents/skills/xrk-mobile-apk/scripts/agt-rebuild-runtime.py --version $ver"
Write-Host "  python .agents/skills/xrk-mobile-apk/scripts/agt-pull-runtime.py"
Write-Host "  pwsh -File .agents/skills/xrk-mobile-apk/scripts/build-install-mumu.ps1"
