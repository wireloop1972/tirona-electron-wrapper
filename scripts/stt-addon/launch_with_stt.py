# launch_with_stt.py – Wrapper that adds the STT endpoint to the Chatterbox
# TTS server without modifying the upstream server.py.
#
# tts-manager.ts spawns this instead of server.py so that both /tts and /stt
# are available on the same port.

import logging

logger = logging.getLogger("launch_with_stt")

# Import the FastAPI app created by Chatterbox's server.py.
# Because server.py guards uvicorn.run() behind `if __name__ == "__main__"`,
# this import only defines the app + routes without starting the server.
from server import app  # noqa: E402

# Attach the STT router to the existing app.
try:
  from stt_addon import stt_router
  app.include_router(stt_router)
  logger.info("STT addon router mounted on /stt")
except ImportError:
  logger.warning("stt_addon not found – STT endpoint will not be available")
except Exception as exc:
  logger.error(f"Failed to mount STT addon: {exc}", exc_info=True)

if __name__ == "__main__":
  from config import get_host, get_port
  import uvicorn

  host = get_host()
  port = get_port()

  logger.info(f"Starting TTS+STT server on http://{host}:{port}")
  uvicorn.run(
    app,
    host=host,
    port=port,
    log_level="info",
    workers=1,
  )
