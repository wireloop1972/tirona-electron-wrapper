<#
.SYNOPSIS
  Copies heavy static assets (PBR textures, HDRIs, ground textures) from
  the Battlemap Next.js public/ folder into the Electron wrapper's
  static-pack/ directory for bundling with Steam builds.

.PARAMETER BattlemapPath
  Path to the Battlemap Next.js project root.
  Default: ..\Battlemap (relative to the electronwrapper project root).

.PARAMETER OutputDir
  Output directory for the static pack.
  Default: static-pack (relative to the electronwrapper project root).

.EXAMPLE
  .\copy-static-pack.ps1
  .\copy-static-pack.ps1 -BattlemapPath "C:\wireloop\Tirona\Battlemap"
#>

param(
  [string]$BattlemapPath,
  [string]$OutputDir
)

$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

if (-not $BattlemapPath) {
  $BattlemapPath = Join-Path (Split-Path -Parent $ProjectRoot) "Battlemap"
}

if (-not $OutputDir) {
  $OutputDir = Join-Path $ProjectRoot "static-pack"
}

$publicDir = Join-Path $BattlemapPath "public"

# ── Validate ──────────────────────────────────────────────────────────────────

if (-not (Test-Path $publicDir)) {
  Write-Error "Battlemap public/ folder not found at: $publicDir"
  exit 1
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Tirona Static Pack Builder"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Source : $publicDir"
Write-Host "  Output : $OutputDir"
Write-Host ""

# ── Folders to copy recursively ───────────────────────────────────────────────

$recursiveFolders = @(
  "textures\pbr",
  "textures\skybox",
  "textures\ground",
  "hdr"
)

# ── Loose files in textures/ (non-recursive) ─────────────────────────────────

$looseTextureFiles = @(
  "Stonebrook.jpg",
  "stonebrookheight.png",
  "wood_edge.png",
  "grass_diffuse.jpg",
  "rock_diffuse.jpg",
  "snow_diffuse.jpg",
  "ground.jpg",
  "ground_blend_map.png",
  "StonebrookOLD.jpg"
)

# ── Clean output ──────────────────────────────────────────────────────────────

if (Test-Path $OutputDir) {
  Write-Host "[1/3] Cleaning existing static-pack..." -ForegroundColor Yellow
  Remove-Item $OutputDir -Recurse -Force
}

New-Item $OutputDir -ItemType Directory -Force | Out-Null

# ── Copy recursive folders ────────────────────────────────────────────────────

Write-Host "[2/3] Copying static asset folders..." -ForegroundColor Yellow

foreach ($folder in $recursiveFolders) {
  $src  = Join-Path $publicDir $folder
  $dest = Join-Path $OutputDir $folder

  if (Test-Path $src) {
    New-Item $dest -ItemType Directory -Force | Out-Null
    robocopy $src $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null

    $count = (Get-ChildItem $dest -Recurse -File).Count
    $size  = [math]::Round(
      (Get-ChildItem $dest -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1
    )
    Write-Host "  $folder : $size MB ($count files)"
  } else {
    Write-Host "  $folder : SKIPPED (not found)" -ForegroundColor DarkGray
  }
}

# ── Copy loose texture files ──────────────────────────────────────────────────

Write-Host "[3/3] Copying loose texture files..." -ForegroundColor Yellow

$texturesDest = Join-Path $OutputDir "textures"
if (-not (Test-Path $texturesDest)) {
  New-Item $texturesDest -ItemType Directory -Force | Out-Null
}

$looseCount = 0
foreach ($file in $looseTextureFiles) {
  $src = Join-Path $publicDir "textures\$file"
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $texturesDest $file) -Force
    $looseCount++
  }
}
Write-Host "  Loose textures: $looseCount files copied"

# ── Summary ───────────────────────────────────────────────────────────────────

$totalFiles = (Get-ChildItem $OutputDir -Recurse -File).Count
$totalSize  = [math]::Round(
  (Get-ChildItem $OutputDir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1
)

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Static pack ready!"
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Total: $totalSize MB ($totalFiles files)"
Write-Host "  Path : $OutputDir"
Write-Host ""
