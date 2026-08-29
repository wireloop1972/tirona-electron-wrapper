<#
.SYNOPSIS
    Build the AMD ROCm variant of the TTS server env into tts-server-amd/.

.DESCRIPTION
    Windows-only. Assembles an embedded Python 3.12 + AMD ROCm 7.2.1 PyTorch
    environment mirroring the known-good NVIDIA env's dependency pins, then
    copies the server code, voices, HF model cache and STT models from the
    existing tts-server/ tree (which must already be built — run
    setup-tts-server.ps1 first).

    The result ships as the TTS depot (4503863) on the AMD Steam beta branch
    via steam/app_build_amd.vdf. The wrapper auto-detects which backend it
    got from the installed torch wheel name (see getBundledBackend in
    src/tts-manager.ts) — same layout, same path, no code fork.

    Target GPUs: RDNA3/RDNA4 (RX 7700 XT+, RX 9000) + Strix Halo APUs.
    Testers need AMD Adrenalin driver 26.2.2+. AMD's wheels are a public
    preview; expect rough edges. STT (CTranslate2) has no ROCm build and is
    forced to CPU by the wrapper at spawn time (STT_DEVICE=cpu).

.PARAMETER WorkDir
    Where wheels are downloaded. Default: .amd-wheels under the repo root.

.PARAMETER SkipDownload
    Reuse already-downloaded wheels in WorkDir.

.EXAMPLE
    .\scripts\setup-tts-server-amd.ps1
#>

param(
  [string]$WorkDir,
  [switch]$SkipDownload
)

$ErrorActionPreference = "Stop"

function Write-Step  { param($msg) Write-Host ("`n==> " + $msg) -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host ("[OK] " + $msg) -ForegroundColor Green }
function Write-Err   { param($msg) Write-Host ("[ERROR] " + $msg) -ForegroundColor Red }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent $ScriptDir
$SrcServer = Join-Path $RootDir "tts-server"
$DstServer = Join-Path $RootDir "tts-server-amd"
$PyDir     = Join-Path $DstServer "python_embedded"
$Py        = Join-Path $PyDir "python.exe"
if (-not $WorkDir) { $WorkDir = Join-Path $RootDir ".amd-wheels" }

if (-not (Test-Path (Join-Path $SrcServer "server.py"))) {
  Write-Err "tts-server/ not found or incomplete - run setup-tts-server.ps1 first"
  exit 1
}

# -- 1. Download wheels -------------------------------------------------------
# Python 3.12 is REQUIRED by AMD's Windows ROCm wheels (cp312 only).
# 3.12.10 is the last 3.12.x with python.org binary artifacts.

$RocmBase = "https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1"
$Downloads = @(
  @{ n = "python-3.12.10-embed-amd64.zip"
     u = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip" },
  @{ n = "get-pip.py"; u = "https://bootstrap.pypa.io/get-pip.py" },
  @{ n = "rocm_sdk_core-7.2.1-py3-none-win_amd64.whl"
     u = "$RocmBase/rocm_sdk_core-7.2.1-py3-none-win_amd64.whl" },
  @{ n = "rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl"
     u = "$RocmBase/rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl" },
  @{ n = "rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl"
     u = "$RocmBase/rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl" },
  @{ n = "rocm-7.2.1.tar.gz"; u = "$RocmBase/rocm-7.2.1.tar.gz" },
  @{ n = "torch-2.9.1+rocm7.2.1-cp312-cp312-win_amd64.whl"
     u = "$RocmBase/torch-2.9.1%2Brocm7.2.1-cp312-cp312-win_amd64.whl" },
  @{ n = "torchaudio-2.9.1+rocm7.2.1-cp312-cp312-win_amd64.whl"
     u = "$RocmBase/torchaudio-2.9.1%2Brocm7.2.1-cp312-cp312-win_amd64.whl" }
)

if (-not $SkipDownload) {
  Write-Step "Downloading Python 3.12 + ROCm 7.2.1 wheels (~2.1 GB)..."
  New-Item $WorkDir -ItemType Directory -Force | Out-Null
  foreach ($d in $Downloads) {
    $dest = Join-Path $WorkDir $d.n
    if (Test-Path $dest) { Write-Host ("  cached  " + $d.n); continue }
    Write-Host ("  fetch   " + $d.n)
    curl.exe -sSLo $dest $d.u
    if ($LASTEXITCODE -ne 0) { Write-Err ("download failed: " + $d.n); exit 1 }
  }
  Write-Ok "Downloads ready"
}

# -- 2. Embedded Python 3.12 --------------------------------------------------

Write-Step "Extracting embedded Python 3.12..."
if (Test-Path $PyDir) { Remove-Item $PyDir -Recurse -Force }
New-Item $PyDir -ItemType Directory -Force | Out-Null
Expand-Archive (Join-Path $WorkDir "python-3.12.10-embed-amd64.zip") -DestinationPath $PyDir -Force

# The embeddable distro ships with site-packages disabled; enable it or pip
# and every installed package are invisible to the interpreter. The ".."
# entry puts the server directory itself on sys.path — with a ._pth present,
# embedded Python does NOT add the script's own directory, so without it
# launch_with_stt.py cannot import its sibling server.py (mirrors the
# NVIDIA env's python310._pth).
@"
python312.zip
.
Lib\site-packages
..
import site
"@ | Out-File (Join-Path $PyDir "python312._pth") -Encoding ascii
Write-Ok "Python extracted"

Write-Step "Bootstrapping pip + setuptools..."
& $Py (Join-Path $WorkDir "get-pip.py") --no-warn-script-location --quiet
if ($LASTEXITCODE -ne 0) { Write-Err "get-pip failed"; exit 1 }
# Embedded Python cannot bootstrap build isolation; sdists (rocm meta pkg,
# chatterbox git) need setuptools present + --no-build-isolation.
# PINNED <81: resemble-perth imports pkg_resources, which setuptools 81+
# removed - with newer setuptools the watermarker import silently degrades
# to None and chatterbox model load dies with "'NoneType' is not callable".
& $Py -m pip install --no-cache-dir --no-warn-script-location "setuptools==80.9.0" wheel
if ($LASTEXITCODE -ne 0) { Write-Err "setuptools install failed"; exit 1 }
Write-Ok "pip ready"

# -- 3. ROCm SDK + PyTorch ----------------------------------------------------

Write-Step "Installing ROCm SDK (this unpacks ~3 GB)..."
& $Py -m pip install --no-cache-dir --no-warn-script-location `
  (Join-Path $WorkDir "rocm_sdk_core-7.2.1-py3-none-win_amd64.whl") `
  (Join-Path $WorkDir "rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl") `
  (Join-Path $WorkDir "rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl")
if ($LASTEXITCODE -ne 0) { Write-Err "rocm sdk install failed"; exit 1 }
& $Py -m pip install --no-cache-dir --no-warn-script-location --no-build-isolation `
  (Join-Path $WorkDir "rocm-7.2.1.tar.gz")
if ($LASTEXITCODE -ne 0) { Write-Err "rocm meta install failed"; exit 1 }

Write-Step "Installing PyTorch ROCm (--no-deps; deps come from the pin list)..."
& $Py -m pip install --no-cache-dir --no-deps --no-warn-script-location `
  (Join-Path $WorkDir "torch-2.9.1+rocm7.2.1-cp312-cp312-win_amd64.whl") `
  (Join-Path $WorkDir "torchaudio-2.9.1+rocm7.2.1-cp312-cp312-win_amd64.whl")
if ($LASTEXITCODE -ne 0) { Write-Err "torch install failed"; exit 1 }
Write-Ok "ROCm PyTorch installed"

# -- 4. Mirrored dependency set ----------------------------------------------

Write-Step "Installing mirrored dependency pins..."
$Req = Join-Path $ScriptDir "requirements-amd.txt"
if (-not (Test-Path $Req)) { Write-Err "scripts/requirements-amd.txt missing"; exit 1 }
& $Py -m pip install --no-cache-dir --no-deps --no-warn-script-location -r $Req
if ($LASTEXITCODE -ne 0) { Write-Err "requirements install failed"; exit 1 }

Write-Step "Installing chatterbox-tts (pinned commit, --no-deps)..."
& $Py -m pip install --no-cache-dir --no-deps --no-warn-script-location --no-build-isolation `
  "chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@7ca5f1bf82c9e6004c16e8ca537398f9df74f4eb"
if ($LASTEXITCODE -ne 0) { Write-Err "chatterbox install failed"; exit 1 }
Write-Ok "Python environment complete"

# -- 5. Server code + shared payloads ----------------------------------------

Write-Step "Copying server code + voices + model caches from tts-server/..."
foreach ($f in 'server.py','config.py','engine.py','utils.py','models.py',
               'download_model.py','launch_with_stt.py','stt_addon.py','config.yaml') {
  Copy-Item (Join-Path $SrcServer $f) (Join-Path $DstServer $f) -Force
}
foreach ($d in 'ui','static','voices','reference_audio','hf_cache','models') {
  robocopy (Join-Path $SrcServer $d) (Join-Path $DstServer $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { Write-Err ("robocopy failed for " + $d); exit 1 }
}
foreach ($d in 'logs','outputs','output','model_cache') {
  New-Item (Join-Path $DstServer $d) -ItemType Directory -Force | Out-Null
}
Write-Ok "Server files copied"

# -- 6. Validation ------------------------------------------------------------

Write-Step "Validating imports..."
& $Py -c "import torch; print('torch', torch.__version__, '| hip', torch.version.hip)"
if ($LASTEXITCODE -ne 0) { Write-Err "torch import failed"; exit 1 }
& $Py -c "import chatterbox, fastapi, uvicorn, librosa, soundfile, parselmouth, yaml, pydub; from faster_whisper import WhisperModel; print('imports OK')"
if ($LASTEXITCODE -ne 0) { Write-Err "dependency import failed"; exit 1 }

$m = Get-ChildItem $DstServer -Recurse -File | Measure-Object -Property Length -Sum
Write-Ok ("tts-server-amd ready: {0:N2} GB, {1} files" -f ($m.Sum/1GB), $m.Count)
Write-Host ""
Write-Host "Next: stage content\win_tts_amd and upload with steam/app_build_amd.vdf"
Write-Host "On a machine without a supported AMD GPU the engine falls back to CPU"
Write-Host "(config device 'cuda' -> functional test fails -> cpu) - that is the"
Write-Host "expected local-validation path; real GPU testing needs AMD silicon."
