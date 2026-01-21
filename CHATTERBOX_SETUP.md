# Chatterbox TTS Server Setup

## Electron/Next.js Integration Status: COMPLETE

The Electron wrapper integration is finished. No further code changes are needed.

**What the Electron app does:**
- Sends correct OpenAI-style requests to `http://127.0.0.1:4123/v1/audio/speech`
- Request body: `{"input":"...", "response_format":"wav"}`
- No `model` or `voice` fields (uses Chatterbox default voice)
- Test page targets only Chatterbox (Orpheus removed from test flow)

**If you see HTTP 500 errors**, the problem is the Chatterbox server configuration, not the Electron/Next.js code.

---

## Chatterbox Server Configuration Required

The remaining setup must be done on the **Chatterbox server side** by whoever installs/configures that server.

### 1. Install Chatterbox TTS API

Follow the official documentation:
- Repository: https://github.com/travisvn/chatterbox-tts-api
- Docs: https://chatterboxtts.com/docs

### 2. Configure Model Path

Set environment variables in `.env` or system environment:

```env
MODEL_NAME=chatterbox-base    # or chatterbox-turbo
MODEL_PATH=/path/to/models    # where model weights are stored
```

### 3. Download Model Weights

Ensure the Chatterbox model files are downloaded to the configured `MODEL_PATH` directory. The server will attempt to download from Hugging Face on first run, but this may fail silently if:
- Network/firewall blocks Hugging Face
- Insufficient disk space
- Missing write permissions

### 4. Configure Voice Mapping (Optional)

If you see warnings like `Using default voice for OpenAI voice 'alloy' (no alias mapping)`, you can either:

**Option A:** Map OpenAI voice aliases to Chatterbox voices in your server config:
```env
VOICE_ALIAS_ALLOY=default
VOICE_ALIAS_ECHO=default
```

**Option B:** Leave it as-is if the built-in default voice works for your use case.

---

## Verification: Test Server Independently

Before using with Electron, verify the Chatterbox server works on its own:

### Start the server
```bash
cd tts-binaries/chatterbox_server
./chatterbox_server.exe --port 4123
```

### Test with curl
```bash
curl -X POST http://127.0.0.1:4123/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input":"Test one two","response_format":"wav"}' \
  --output test.wav
```

### Expected result
- HTTP 200 response
- Valid `test.wav` audio file created
- No "Failed to initialize model" errors in server logs

---

## Once Server Works

When the curl test above succeeds without HTTP 500 errors, the Electron integration will work automatically:

1. Start Electron: `$env:TTS_TEST='true'; npm start`
2. The test page will auto-start Chatterbox
3. Click "Generate & Play" to test speech synthesis

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Failed to initialize model:` | Model not configured/downloaded | Set `MODEL_NAME`/`MODEL_PATH`, download weights |
| `Using default voice for OpenAI voice 'alloy'` | Voice alias not mapped | Configure voice mapping or ignore if default works |
| HTTP 500 on `/v1/audio/speech` | Model not loaded | Fix model configuration first |
| Connection refused | Server not running | Start `chatterbox_server.exe --port 4123` |

---

## Summary

- **Electron/Next.js code**: Done, no changes needed
- **Chatterbox server**: Requires model configuration by infra/server admin
- **Test independently**: Use curl before integrating with Electron
