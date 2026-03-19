# stt_addon.py – faster-whisper STT endpoint for the Chatterbox TTS server.
# Copied into tts-server/ by setup-tts-server.ps1.

import os
import logging
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException

logger = logging.getLogger("stt_addon")

# ---------------------------------------------------------------------------
# Model configuration (env-overridable)
# ---------------------------------------------------------------------------

MODEL_SIZE = os.getenv("STT_MODEL_SIZE", "medium.en")
DEVICE = os.getenv("STT_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "float16")
DOWNLOAD_ROOT = os.getenv("STT_DOWNLOAD_ROOT", "./models/stt")

_stt_model = None
_model_load_error: str | None = None


def _load_model():
  """Lazy-load the whisper model on first request (or at import time)."""
  global _stt_model, _model_load_error

  if _stt_model is not None:
    return _stt_model

  try:
    from faster_whisper import WhisperModel
  except ImportError:
    _model_load_error = "faster-whisper is not installed"
    logger.error(_model_load_error)
    return None

  os.makedirs(DOWNLOAD_ROOT, exist_ok=True)

  device = DEVICE
  compute = COMPUTE_TYPE

  # Fall back to CPU if CUDA is requested but unavailable
  if device == "cuda":
    try:
      import torch
      if not torch.cuda.is_available():
        logger.warning("CUDA not available, falling back to CPU for STT")
        device = "cpu"
        compute = "int8"
    except ImportError:
      # torch not present – let faster-whisper try CUDA; it uses CTranslate2
      pass

  logger.info(
    f"Loading STT model: size={MODEL_SIZE}, device={device}, "
    f"compute_type={compute}, download_root={DOWNLOAD_ROOT}"
  )
  try:
    _stt_model = WhisperModel(
      MODEL_SIZE,
      device=device,
      compute_type=compute,
      download_root=DOWNLOAD_ROOT,
    )
    logger.info("STT model loaded successfully")
    return _stt_model
  except Exception as exc:
    _model_load_error = str(exc)
    logger.error(f"Failed to load STT model: {exc}", exc_info=True)
    return None


# Eagerly load on import so the model is warm when the first request arrives.
_load_model()

# ---------------------------------------------------------------------------
# FastAPI router
# ---------------------------------------------------------------------------

stt_router = APIRouter(tags=["STT"])


@stt_router.post("/stt")
async def transcribe(audio: UploadFile = File(...)):
  """Transcribe an uploaded audio file using faster-whisper."""

  model = _load_model()
  if model is None:
    raise HTTPException(
      status_code=503,
      detail=f"STT model not available: {_model_load_error or 'unknown error'}",
    )

  if not audio.filename:
    raise HTTPException(status_code=400, detail="No file uploaded")

  ext = ".wav"
  if audio.filename:
    lower = audio.filename.lower()
    if lower.endswith(".webm"):
      ext = ".webm"
    elif lower.endswith(".ogg"):
      ext = ".ogg"
    elif lower.endswith(".mp3"):
      ext = ".mp3"

  tmp_path: str | None = None
  try:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
      tmp.write(await audio.read())
      tmp_path = tmp.name

    segments, info = model.transcribe(
      tmp_path,
      language="en",
      beam_size=1,
      vad_filter=True,
      vad_parameters=dict(
        min_silence_duration_ms=500,
        speech_pad_ms=200,
      ),
    )
    text = " ".join(s.text for s in segments).strip()
    return {
      "text": text,
      "language": info.language,
      "duration": info.duration,
    }
  except Exception as exc:
    logger.error(f"STT transcription failed: {exc}", exc_info=True)
    raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")
  finally:
    if tmp_path:
      try:
        os.unlink(tmp_path)
      except OSError:
        pass
