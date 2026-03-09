<#
.SYNOPSIS
    Set up the Chatterbox Turbo TTS server for bundling with the Tirona Electron app.

.DESCRIPTION
    Clones devnen/Chatterbox-TTS-Server, runs Portable Mode setup with NVIDIA CUDA,
    writes a locked config.yaml for Turbo-only / CUDA-only operation on port 4123,
    and copies the result into tts-server/ for electron-builder to bundle.

.PARAMETER RepoPath
    Path where Chatterbox-TTS-Server will be cloned. Default: ../Chatterbox-TTS-Server

.PARAMETER OutputPath
    Destination inside the Electron project. Default: tts-server

.PARAMETER SkipClone
    Skip cloning/updating the repository (use existing local copy)

.PARAMETER Port
    Port the TTS server will listen on. Default: 4123

.EXAMPLE
    .\scripts\setup-tts-server.ps1

.EXAMPLE
    .\scripts\setup-tts-server.ps1 -RepoPath "C:\dev\Chatterbox-TTS-Server" -SkipClone
#>

param(
  [string]$RepoPath = "..\Chatterbox-TTS-Server",
  [string]$OutputPath = "tts-server",
  [switch]$SkipClone,
  [int]$Port = 4123,
  [ValidateSet('nvidia', 'nvidia-cu128')]
  [string]$GpuTarget = 'nvidia-cu128'
)

$ErrorActionPreference = "Stop"

function Write-Step  { param($msg) Write-Host ("`n==> " + $msg) -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host ("[OK] " + $msg) -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host ("[WARN] " + $msg) -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host ("[ERROR] " + $msg) -ForegroundColor Red }

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir      = Split-Path -Parent $ScriptDir
$RepoFull     = if ([IO.Path]::IsPathRooted($RepoPath)) { $RepoPath } else { Join-Path $RootDir $RepoPath }
$OutputFull   = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $RootDir $OutputPath }

Write-Host "============================================" -ForegroundColor Magenta
Write-Host " Chatterbox Turbo TTS Server Setup"          -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host ("Repository:  " + $RepoFull)
Write-Host ("Output:      " + $OutputFull)
Write-Host ("Port:        " + $Port)
Write-Host ""

# -- 1. Clone / update --------------------------------------------------------

if (-not $SkipClone) {
  Write-Step "Cloning / updating Chatterbox-TTS-Server..."

  if (Test-Path $RepoFull) {
    Write-Host "Repository exists, pulling latest..."
    Push-Location $RepoFull
    try { git pull origin main } catch { Write-Warn ("git pull failed: " + $_) }
    Pop-Location
  } else {
    git clone https://github.com/devnen/Chatterbox-TTS-Server.git $RepoFull
  }
  Write-Ok "Repository ready"
} else {
  Write-Step "Skipping clone (using existing repo)"
  if (-not (Test-Path $RepoFull)) {
    Write-Err ("Repository not found at " + $RepoFull); exit 1
  }
}

# -- 2. Run Portable Mode setup with NVIDIA -----------------------------------

Write-Step ("Running Portable Mode setup (--portable --" + $GpuTarget + ")...")

$gpuFlag   = "--" + $GpuTarget
$setupLog  = Join-Path $RepoFull "setup_stdout.log"
$setupErr  = Join-Path $RepoFull "setup_stderr.log"

$reinstallFlag = ""
if (Test-Path (Join-Path $RepoFull "python_embedded")) {
  Write-Host "Existing portable environment detected, will reinstall..."
  $reinstallFlag = "--reinstall"
}

$argList = "start.py --portable " + $gpuFlag
if ($reinstallFlag) { $argList = $argList + " " + $reinstallFlag }

Write-Host ("  Command: python " + $argList)
Write-Host ("  Working directory: " + $RepoFull)
Write-Host "  (Running in background, waiting for install to complete...)"

$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

$proc = Start-Process -FilePath "python" `
  -ArgumentList $argList `
  -WorkingDirectory $RepoFull `
  -NoNewWindow -PassThru `
  -RedirectStandardOutput $setupLog `
  -RedirectStandardError $setupErr

$maxWaitSec  = 900
$pollSec     = 5
$waited      = 0
$installDone = $false

while ($waited -lt $maxWaitSec -and -not $proc.HasExited) {
  Start-Sleep -Seconds $pollSec
  $waited += $pollSec

  if (Test-Path $setupLog) {
    $logContent = Get-Content $setupLog -Raw -ErrorAction SilentlyContinue
    if ($logContent -and ($logContent -match "Uvicorn running|Application startup complete|Server ready")) {
      $installDone = $true
      break
    }
  }

  $min = [math]::Floor($waited / 60)
  $sec = $waited % 60
  Write-Host ("  Waiting... " + $min + "m " + $sec + "s elapsed") -ForegroundColor DarkGray
}

if ($installDone) {
  Write-Ok "Installation and model download complete. Stopping server..."
} elseif ($proc.HasExited) {
  $exitCode = $proc.ExitCode
  Write-Host ""
  if (Test-Path $setupErr) {
    $errContent = Get-Content $setupErr -Raw -ErrorAction SilentlyContinue
    if ($errContent) {
      Write-Host "--- stderr ---" -ForegroundColor DarkGray
      Write-Host $errContent -ForegroundColor DarkGray
    }
  }
  if (Test-Path $setupLog) {
    Write-Host "--- stdout (last 30 lines) ---" -ForegroundColor DarkGray
    Get-Content $setupLog -Tail 30 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
  }
  if ($exitCode -ne 0) {
    Write-Err ("Setup process exited with code " + $exitCode)
    exit 1
  }
} else {
  Write-Warn ("Timed out after " + $maxWaitSec + " seconds")
}

if (-not $proc.HasExited) {
  Write-Host "  Stopping server process tree (PID " + $proc.Id + ")..."
  taskkill /F /T /PID $proc.Id 2>$null | Out-Null
  Start-Sleep -Seconds 3
}

if (Test-Path $setupLog) {
  $logContent = Get-Content $setupLog -Raw -ErrorAction SilentlyContinue
  if ($logContent -match "CRITICAL|failed to load|CUDA error") {
    Write-Warn "Server reported errors during model loading (see log)"
    Write-Host "--- Relevant log lines ---" -ForegroundColor Yellow
    Get-Content $setupLog | Select-String -Pattern "ERROR|CRITICAL|CUDA error" |
      ForEach-Object { Write-Host ("  " + $_.Line) -ForegroundColor Yellow }
    Write-Host ""
  }
}

Remove-Item $setupLog -ErrorAction SilentlyContinue
Remove-Item $setupErr -ErrorAction SilentlyContinue

Write-Ok "Portable Mode environment created"

# -- 3. Write locked config.yaml ----------------------------------------------

Write-Step ("Writing locked config.yaml (Turbo, CUDA, port " + $Port + ")...")

$ConfigYaml = @"
# Tirona RPG - Chatterbox Turbo TTS Server config
# Generated by setup-tts-server.ps1. Do not edit by hand in prod.

server:
  host: "127.0.0.1"
  port: $Port
  log_level: "info"
  open_browser: false

model:
  repo_id: "ResembleAI/chatterbox"

tts_engine:
  device: "cuda"
  default_engine: "turbo"
  predefined_voices_path: "./voices"
  reference_audio_path: "./reference_audio"
  default_voice_id: "oliverbritmale"

generation_defaults:
  temperature: 0.7
  exaggeration: 0.5
  cfg_weight: 0.5
  seed: 0
  speed_factor: 1.0
  language: "en"

audio_output:
  format: "wav"
  sample_rate: 24000
  max_reference_duration_sec: 12

paths:
  output: "./output"

ui:
  title: "Tirona TTS"
  show_language_select: false

debug:
  save_intermediate_audio: false
"@

Set-Content -Path (Join-Path $RepoFull "config.yaml") -Value $ConfigYaml -Encoding UTF8
Write-Ok "config.yaml written"

# -- 4. Copy to output directory -----------------------------------------------

Write-Step ("Copying server to " + $OutputFull + " ...")

if (Test-Path $OutputFull) {
  Write-Host "Removing previous output directory..."
  Remove-Item -Recurse -Force $OutputFull
}

$ExcludeDirs = @('.git', '__pycache__', '.github', 'tests', 'node_modules')

robocopy $RepoFull $OutputFull /E /NFL /NDL /NJH /NJS `
  /XD ($ExcludeDirs -join ' ')

# robocopy returns 0-7 for success
if ($LASTEXITCODE -gt 7) {
  Write-Err ("robocopy failed with exit code " + $LASTEXITCODE); exit 1
}

Write-Ok ("Server copied to " + $OutputFull)

# -- 5. Verify ----------------------------------------------------------------

Write-Step "Verifying..."

$PythonExe = Join-Path $OutputFull "python_embedded\python.exe"
$ServerPy  = Join-Path $OutputFull "server.py"
$ConfigOut = Join-Path $OutputFull "config.yaml"

$allGood = $true
foreach ($f in @($PythonExe, $ServerPy, $ConfigOut)) {
  if (Test-Path $f) {
    Write-Host ("  OK  " + $f)
  } else {
    Write-Err ("  MISSING  " + $f)
    $allGood = $false
  }
}

if (-not $allGood) {
  Write-Err "Verification failed - some files are missing"; exit 1
}

$DirSize = (Get-ChildItem $OutputFull -Recurse -File | Measure-Object -Property Length -Sum).Sum
$SizeInGB = [math]::Round($DirSize / 1073741824, 2)

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host (" Setup Complete!  (" + $SizeInGB + " gigabytes)") -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "To test manually:"
Write-Host ("  cd " + $OutputFull)
Write-Host '  .\python_embedded\python.exe server.py'
Write-Host ("  curl http://127.0.0.1:" + $Port + "/api/ui/initial-data")
Write-Host ""
Write-Host "To run in Electron:"
Write-Host '  npm run test:tts'
Write-Host ""
