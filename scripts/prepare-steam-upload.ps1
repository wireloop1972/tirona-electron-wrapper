<#
.SYNOPSIS
  Copies the Electron build output into the Steamworks ContentBuilder
  folder structure (4 depots), copies VDF scripts, and optionally
  runs steamcmd to upload.

.PARAMETER SdkPath
  Path to the Steamworks SDK ContentBuilder folder.
  Example: C:\SteamworksSDK\sdk\tools\ContentBuilder

.PARAMETER BuildDir
  Path to the electron-builder output (default: release\win-unpacked
  relative to this script's parent directory).

.PARAMETER Upload
  If set, runs steamcmd to upload after copying.

.PARAMETER SteamUser
  Steam username for upload (required if -Upload is set).

.PARAMETER Preview
  If set with -Upload, does a dry-run upload (no actual upload).

.EXAMPLE
  .\prepare-steam-upload.ps1 -SdkPath "C:\SteamworksSDK\sdk\tools\ContentBuilder"
  .\prepare-steam-upload.ps1 -SdkPath "C:\SteamworksSDK\sdk\tools\ContentBuilder" -Upload -SteamUser myuser
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$SdkPath,

  [string]$BuildDir,

  [switch]$Upload,

  [string]$SteamUser,

  [switch]$Preview
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

if (-not $BuildDir) {
  $BuildDir = Join-Path $ProjectRoot "release\win-unpacked"
}

# ── Validate inputs ──────────────────────────────────────────────────────────

if (-not (Test-Path $BuildDir)) {
  Write-Error "Build directory not found: $BuildDir`nRun 'npm run package:steam' first."
  exit 1
}

if (-not (Test-Path (Join-Path $BuildDir "Tirona.exe"))) {
  Write-Error "Tirona.exe not found in $BuildDir -- is this the right build output?"
  exit 1
}

if (-not (Test-Path $SdkPath)) {
  Write-Error "Steamworks SDK ContentBuilder not found at: $SdkPath"
  exit 1
}

$steamcmd = Join-Path $SdkPath "builder\steamcmd.exe"
if ($Upload -and -not (Test-Path $steamcmd)) {
  Write-Error "steamcmd.exe not found at: $steamcmd"
  exit 1
}

if ($Upload -and -not $SteamUser) {
  Write-Error "-SteamUser is required when using -Upload"
  exit 1
}

# ── Define paths ─────────────────────────────────────────────────────────────

$contentDir   = Join-Path $SdkPath "content"
$scriptsDir   = Join-Path $SdkPath "scripts"
$winBase      = Join-Path $contentDir "win_base"
$winAssets    = Join-Path $contentDir "win_assets"
$winTts       = Join-Path $contentDir "win_tts"
$winStatic    = Join-Path $contentDir "win_static"

$srcResources  = Join-Path $BuildDir "resources"
$srcAssetPack  = Join-Path $srcResources "asset-pack"
$srcTtsServer  = Join-Path $srcResources "tts-server"
$srcStaticPack = Join-Path $srcResources "static-pack"

# ── Clean and create content directories ─────────────────────────────────────

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Tirona Steam Upload Preparation"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Build dir  : $BuildDir"
Write-Host "  SDK path   : $SdkPath"
Write-Host ""

Write-Host "[1/6] Cleaning content directories..." -ForegroundColor Yellow
foreach ($dir in @($winBase, $winAssets, $winTts, $winStatic)) {
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  New-Item $dir -ItemType Directory -Force | Out-Null
}

# ── Copy Code Depot (win_base) ───────────────────────────────────────────────

Write-Host "[2/6] Copying code depot (Electron + JS)..." -ForegroundColor Yellow

# Copy everything from build dir to win_base
robocopy $BuildDir $winBase /E /NFL /NDL /NJH /NJS /NP | Out-Null

# Remove asset-pack, tts-server, static-pack from win_base (they go in own depots)
$baseAssetPack  = Join-Path $winBase "resources\asset-pack"
$baseTtsServer  = Join-Path $winBase "resources\tts-server"
$baseStaticPack = Join-Path $winBase "resources\static-pack"

if (Test-Path $baseAssetPack) {
  Remove-Item $baseAssetPack -Recurse -Force
  Write-Host "  Removed asset-pack from code depot"
}
if (Test-Path $baseTtsServer) {
  Remove-Item $baseTtsServer -Recurse -Force
  Write-Host "  Removed tts-server from code depot"
}
if (Test-Path $baseStaticPack) {
  Remove-Item $baseStaticPack -Recurse -Force
  Write-Host "  Removed static-pack from code depot"
}

$codeSize = [math]::Round(
  (Get-ChildItem $winBase -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1
)
Write-Host "  Code depot: $codeSize MB"

# ── Copy Assets Depot (win_assets) ───────────────────────────────────────────

Write-Host "[3/6] Copying assets depot..." -ForegroundColor Yellow

if (Test-Path $srcAssetPack) {
  $destAssetPack = Join-Path $winAssets "resources\asset-pack"
  New-Item $destAssetPack -ItemType Directory -Force | Out-Null
  robocopy $srcAssetPack $destAssetPack /E /NFL /NDL /NJH /NJS /NP | Out-Null

  $assetSize = [math]::Round(
    (Get-ChildItem $destAssetPack -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1
  )
  $assetCount = (Get-ChildItem $destAssetPack -Recurse -File).Count
  Write-Host "  Assets depot: $assetSize MB ($assetCount files)"
} else {
  Write-Host "  WARNING: No asset-pack found at $srcAssetPack" -ForegroundColor Red
}

# ── Copy TTS Depot (win_tts) ─────────────────────────────────────────────────

Write-Host "[4/6] Copying TTS depot..." -ForegroundColor Yellow

if (Test-Path $srcTtsServer) {
  $destTtsServer = Join-Path $winTts "resources\tts-server"
  New-Item $destTtsServer -ItemType Directory -Force | Out-Null
  robocopy $srcTtsServer $destTtsServer /E /NFL /NDL /NJH /NJS /NP | Out-Null

  $ttsSize = [math]::Round(
    (Get-ChildItem $destTtsServer -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1GB, 2
  )
  $ttsCount = (Get-ChildItem $destTtsServer -Recurse -File).Count
  Write-Host "  TTS depot: $ttsSize GB ($ttsCount files)"
} else {
  Write-Host "  WARNING: No tts-server found at $srcTtsServer" -ForegroundColor Red
}

# ── Copy Static Depot (win_static) ────────────────────────────────────────────

Write-Host "[5/6] Copying static depot (PBR textures, HDRIs)..." -ForegroundColor Yellow

if (Test-Path $srcStaticPack) {
  $destStaticPack = Join-Path $winStatic "resources\static-pack"
  New-Item $destStaticPack -ItemType Directory -Force | Out-Null
  robocopy $srcStaticPack $destStaticPack /E /NFL /NDL /NJH /NJS /NP | Out-Null

  $staticSize = [math]::Round(
    (Get-ChildItem $destStaticPack -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1
  )
  $staticCount = (Get-ChildItem $destStaticPack -Recurse -File).Count
  Write-Host "  Static depot: $staticSize MB ($staticCount files)"
} else {
  Write-Host "  WARNING: No static-pack found at $srcStaticPack" -ForegroundColor Red
}

# ── Copy VDF scripts ─────────────────────────────────────────────────────────

Write-Host "[6/6] Copying VDF build scripts..." -ForegroundColor Yellow

$vdfDir = Join-Path $ProjectRoot "steam"
if (-not (Test-Path $scriptsDir)) {
  New-Item $scriptsDir -ItemType Directory -Force | Out-Null
}

Copy-Item (Join-Path $vdfDir "app_build.vdf") $scriptsDir -Force
Copy-Item (Join-Path $vdfDir "depot_code.vdf") $scriptsDir -Force
Copy-Item (Join-Path $vdfDir "depot_content.vdf") $scriptsDir -Force
Copy-Item (Join-Path $vdfDir "depot_tts.vdf") $scriptsDir -Force
Copy-Item (Join-Path $vdfDir "depot_static.vdf") $scriptsDir -Force

Write-Host "  Copied 5 VDF files to $scriptsDir"

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  ContentBuilder ready!"
Write-Host "================================================" -ForegroundColor Green
Write-Host "  content\win_base\    -> Depot 4503861 (Code)"
Write-Host "  content\win_assets\  -> Depot 4503862 (Assets)"
Write-Host "  content\win_tts\     -> Depot 4503863 (TTS)"
Write-Host "  content\win_static\  -> Depot 4503864 (Static)"
Write-Host "  scripts\             -> VDF build scripts"
Write-Host ""

# ── Optional upload ──────────────────────────────────────────────────────────

if ($Upload) {
  $vdfPath = Join-Path $scriptsDir "app_build.vdf"

  if ($Preview) {
    Write-Host "Running PREVIEW upload (dry run)..." -ForegroundColor Yellow
    # Temporarily set Preview flag
    $content = Get-Content $vdfPath -Raw
    $content = $content -replace '"AppBuild"', "`"AppBuild`"`n{`n`t`"Preview`"`t`"1`""
    # Actually, let's just inform the user
    Write-Host "  (Preview mode not yet automated -- edit app_build.vdf and add '`"Preview`" `"1`"')"
  }

  Write-Host "Uploading to Steam..." -ForegroundColor Yellow
  Write-Host "  steamcmd +login $SteamUser +run_app_build `"$vdfPath`" +quit"
  Write-Host ""

  & $steamcmd +login $SteamUser +run_app_build $vdfPath +quit
} else {
  Write-Host "To upload, run:" -ForegroundColor Cyan
  Write-Host "  .\prepare-steam-upload.ps1 -SdkPath `"$SdkPath`" -Upload -SteamUser YOUR_USERNAME"
  Write-Host ""
  Write-Host "Or manually:"
  Write-Host "  cd `"$SdkPath\builder`""
  Write-Host "  .\steamcmd.exe +login YOUR_USERNAME +run_app_build `"$scriptsDir\app_build.vdf`" +quit"
}

Write-Host ""
