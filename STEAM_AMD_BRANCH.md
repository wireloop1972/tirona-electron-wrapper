# AMD ROCm Steam Beta Branch — Build & Ship Runbook

How the AMD voice-synthesis variant is built and shipped. Written 2026-08-21.
Tester-facing instructions live in TESTING_AMD.md.

## Architecture in one paragraph

One wrapper, two TTS depots. The Code/Assets/Static depots are **identical**
across the default (NVIDIA) branch and the AMD beta branch. Only depot
4503863 (TTS) differs: default carries the CUDA env (Python 3.10 +
torch 2.10+cu128), the AMD branch carries the ROCm env (Python 3.12 +
torch 2.9.1+rocm7.2.1) **at the same install path** (`resources/tts-server`).
The wrapper detects which env it received by reading the installed torch
wheel name (`getBundledBackend()` in src/tts-manager.ts) and pairs it with
the matching GPU-vendor check (`detectTtsCapability()`). The HTTP TTS API,
config.yaml (`device: cuda` — HIP masquerades as CUDA), voices, and the
game side are unchanged.

Safety property: a CUDA env on an AMD-only machine (or vice versa) resolves
to "Voice Synthesis unavailable" — never a crash. A ROCm env on a machine
whose driver is too old falls back to CPU inside engine.py's functional
device test.

## Build the AMD env

```powershell
.\scripts\setup-tts-server-amd.ps1
```

Produces `tts-server-amd/` (~18.6 GB): embedded Python 3.12.10, ROCm 7.2.1
SDK + PyTorch from repo.radeon.com, dependency pins mirrored from the
known-good NVIDIA env (scripts/requirements-amd.txt), chatterbox pinned to
the same commit, plus server code / voices / hf_cache / STT models copied
from `tts-server/` (build that first).

Key traps encoded in the script:
- AMD's Windows wheels are **cp312 only** → Python 3.12 mandatory.
- numpy bumped 1.25.2 → 1.26.4 (first cp312 release); onnx/protobuf bumped
  for the same reason.
- Embedded Python needs `import site` enabled in `python312._pth` and
  setuptools installed before any sdist (`--no-build-isolation`).
- STT: CTranslate2 has no ROCm build. The wrapper sets `STT_DEVICE=cpu`
  when it detects the rocm backend (src/tts-manager.ts spawn env).

## Local validation (no AMD GPU needed)

On an NVIDIA/dev machine the ROCm torch sees no HIP device →
`_test_cuda_functionality()` fails → engine.py falls back to **CPU**. That
exercises the full stack (env, model load from bundled hf_cache offline,
generation, /tts + /stt endpoints) minus the HIP kernels themselves:

```powershell
# from tts-server-amd/:
.\python_embedded\python.exe launch_with_stt.py
# then: GET http://127.0.0.1:4123/api/model-info until loaded:true,
# POST /tts with a predefined voice, expect audio/wav bytes.
```

GPU-path validation requires real RDNA3/RDNA4 silicon — that's what the
beta branch is for.

## Stage + upload

```powershell
# Stage the AMD TTS depot (one-time per env rebuild):
robocopy tts-server-amd "C:\SteamworksSDK\sdk\tools\ContentBuilder\content\win_tts_amd\resources\tts-server" /E

# Make sure win_base/win_assets/win_static are current (normal pipeline),
# then upload the AMD build:
cd C:\SteamworksSDK\sdk\tools\ContentBuilder\builder
.\steamcmd.exe +login <user> +run_app_build "..\scripts\app_build_amd.vdf" +quit
```

`steam/app_build_amd.vdf` maps depot 4503863 to `win_tts_amd` and reuses
the other three content dirs — unchanged bytes there mean manifest reuse
and a small upload. VDFs must be copied to the SDK `scripts\` dir first
(prepare-steam-upload.ps1 does the standard four; copy the two `_amd` ones
alongside).

In Steamworks (manual): create/keep a beta branch (e.g. `amdbeta`), set the
AMD BuildID live on **that branch only**. The default branch keeps the
NVIDIA build. Both branches share Code/Assets/Static manifests, so testers
switching branches only re-download the TTS depot.

## Updating voices on both branches

Voice files live in the TTS depot, so a voice update now means BOTH
`win_tts` and `win_tts_amd` staging dirs get the new files, and both
app_build vdfs get uploaded (two BuildIDs, one per branch).

## Known limitations

- ROCm-on-Windows PyTorch is an AMD **public preview**; only RDNA3/RDNA4
  desktop GPUs + Strix Halo APUs pass the wrapper's allowlist
  (src/gpu-detect.ts `AMD_ROCM_WIN_SUPPORTED`).
- Driver floor: Adrenalin 26.2.2. Failure surfaces in the startup dialog
  with an inline hint.
- STT runs on CPU (slightly slower transcribe; TTS unaffected).
- torch 2.9.1 (AMD) vs 2.10.0 (NVIDIA): model + code identical, minor
  version skew accepted; pins otherwise mirrored.
