# Tirona — AMD Voice Synthesis Beta (ROCm)

Instructions for beta testers with an AMD GPU. The default Steam build only
supports NVIDIA; this opt-in branch ships a voice engine built on AMD's
ROCm-for-Windows PyTorch (public preview from AMD).

> **New in this build (Aug 2026):** the voice model was replaced with a
> faster one (Chatterbox Turbo). On NVIDIA it roughly **doubled** generation
> speed. Earlier AMD testers reported 10+ seconds per line — if that was you,
> please re-test: telling us whether this build fixed it is the single most
> useful thing you can do.

## Requirements (hard)

| Requirement | Why |
|---|---|
| A supported AMD GPU (see below) | AMD's Windows ROCm wheels only support these |
| AMD Adrenalin driver **26.2.2 or newer** | Older drivers fail at model load |
| Windows 10/11 x64 | Same as the main game |
| ~20 GB free disk for the TTS depot | Python + ROCm runtime + voice models |

### Supported GPUs

- Radeon RX 7700 XT, RX 7800 XT, RX 7900 GRE / XT / XTX
- Radeon RX 9060 / 9060 XT, RX 9070 / 9070 XT
- Radeon PRO W7800 / W7900, AI PRO R9700
- Ryzen AI Max APUs (Radeon 8050S / 8060S)

**Not supported:** RX 6000 series and older, RX 7600, mobile 7900M, and
Ryzen 7040/8040/AI 300 integrated graphics. On these, the dialog will show
"Voice Synthesis unavailable" — that is expected, not a bug.

## Opting in

1. Steam Library → right-click **Tirona Rebirth** → **Properties**
2. **Betas** tab → select the AMD beta branch from the dropdown
3. Let Steam download the update (~19 GB — it replaces the whole voice engine)
4. Update your AMD driver to Adrenalin 26.2.2+ if you haven't

## Testing

1. Launch the game. In the startup dialog, the GPU line should show your
   card name and "Voice Synthesis available".
2. Turn the Voice Synthesis toggle **On**. First start loads the voice
   model — expect this to take longer than NVIDIA's ~15 s, especially on the
   very first run.
3. You should hear the Narrator test line. When it finishes, the dialog shows
   a green result line like:

   `Voice Synthesis ready · Model load: 15.2s · First line: 1.4s · 3.9× realtime`

   **Please send us that exact line — it is the whole measurement we need.**
   A screenshot is fine.

4. Then play normally and note anything odd: crackle, stutter, wrong voice,
   or lines that take noticeably longer than the test line did.

### What the number means

`× realtime` is how much faster than playback the line was produced. Above
1× means the engine keeps ahead of the narration; below 1× means you will
hear waits. For reference, an **RTX 5080 scores about 3.9×**. If your AMD
card lands well under 1×, that is the problem we are hunting — send the
result line and the two log files below.

## If it fails

The dialog shows a short reason. Most likely fixes, in order:

1. **Driver too old** → install latest Adrenalin, reboot, retry.
2. **Model load timeout on first run** → retry once (first-run GPU shader
   compilation can be slow).
3. Anything else → send us these two files:
   - `%APPDATA%\Tirona\main.log`
   - `<Steam>\steamapps\common\Tirona Rebirth\resources\tts-server\logs\tts_server.log`

If the GPU falls back, the engine may run on **CPU** — you'll notice very
slow line generation (tens of seconds per line). That's the automatic
fallback; report it with the logs above, it usually means the driver or GPU
isn't being picked up.

## Known differences vs the NVIDIA build

- Speech-to-text (voice input) runs on **CPU** on this branch — transcribe
  latency is a bit higher. Voice output uses the GPU.
- First model load is slower than NVIDIA; subsequent runs are faster.
- AMD's ROCm-on-Windows PyTorch is a **public preview** — instability here
  is expected and exactly what this branch is testing. Thanks!
