# Chatterbox TTS Code Changes

These are the code changes needed to make Chatterbox work properly.

---

## Change 1: Already Applied ✓

**File:** `electronwrapper/src/tts-manager.ts`

The `fetchVoices()` function has been updated to handle Chatterbox's different `/voices` endpoint.

---

## Change 2: Needs to be Applied

**File:** `Battlemap/lib/tts/orpheus-service.ts`

**Location:** Lines 163-192 (inside `isOrpheusAvailable()` function)

**Problem:** The function tries to fetch `/v1/audio/voices` which doesn't exist in Chatterbox.

**Find this code (around line 163-192):**

```typescript
  console.log('[TTS] Checking HTTP endpoint:', baseUrl);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`${baseUrl}/v1/audio/voices`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      console.log('[TTS] Voices endpoint returned:', res.status);
      return false;
    }
    
    const data = await res.json();
    console.log('[TTS] Voices response:', JSON.stringify(data));
    
    // Check for voices array
    const voices = data.voices || data.data?.voices || [];
    const hasVoices = Array.isArray(voices) && voices.length > 0;
    
    if (!hasVoices) {
      console.log('[TTS] No voices in response. Keys:', Object.keys(data));
      return false;
    }
    
    console.log('[TTS] ✓ Available with', voices.length, 'voices');
    return true;
```

**Replace with:**

```typescript
  console.log('[TTS] Checking HTTP health endpoint:', baseUrl);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    // Use /health endpoint - supported by both Orpheus and Chatterbox
    const res = await fetch(`${baseUrl}/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      console.log('[TTS] Health endpoint returned:', res.status);
      return false;
    }
    
    const data = await res.json() as { 
      status?: string;
      model_loaded?: boolean;
      initialization_state?: string;
    };
    console.log('[TTS] Health response:', JSON.stringify(data));
    
    // Check if server is healthy/ready (works for both Orpheus and Chatterbox)
    const isHealthy = data.status === 'healthy' || 
                      data.status === 'ok' || 
                      data.model_loaded === true ||
                      data.initialization_state === 'ready';
    
    if (!isHealthy) {
      console.log('[TTS] Server not healthy. Status:', data.status);
      return false;
    }
    
    console.log('[TTS] ✓ Server is healthy and ready');
    return true;
```

---

## Summary of Changes

| File | Change | Status |
|------|--------|--------|
| `electronwrapper/src/tts-manager.ts` | Fix `fetchVoices()` to use `/voices` for Chatterbox | ✓ Done |
| `Battlemap/lib/tts/orpheus-service.ts` | Use `/health` endpoint instead of `/v1/audio/voices` | Needs manual apply |

---

## Testing Notes

The Chatterbox server is confirmed working:
- Health endpoint: `http://127.0.0.1:4123/health` returns healthy status
- Speech endpoint: `http://127.0.0.1:4123/v1/audio/speech` generates audio
- Voices endpoint: `http://127.0.0.1:4123/voices` returns `{voices: [], count: 0}` (no custom voices uploaded)

To start Chatterbox manually:
```powershell
cd C:\wireloop\Tirona\chatterbox-tts-api
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"
.\venv\Scripts\python.exe main.py
```
