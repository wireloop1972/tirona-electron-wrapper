# Character-Entry Cutscene (ENTERTIRONA.mp4) — Setup Runbook

How the "new character enters the game" cutscene is compressed, delivered to
Steam, and played by the web game so it streams from the **local Steam install**
(offline) while still working normally in the browser.

Delivery route: **Vercel Blob → asset-pack** (Assets depot **4503862**), served
by the existing local-asset interceptor. This needs **no Electron code changes** —
the interceptor already serves any `*.blob.vercel-storage.com/<path>` request from
`asset-pack/` when the path is in the bundled manifest, and `.mp4` is already in
the MIME table.

---

## How it works (the retrieval mechanism)

```
                        WEB (browser)                    STEAM (Electron)
game requests the  ──►  streams from Vercel Blob   ──►  session.protocol.handle('https')
blob URL for the        over the network                in src/main.ts intercepts the
cutscene                                                 blob URL, finds the path in the
                                                         bundled manifest, and returns the
                                                         local file from asset-pack/ —
                                                         offline, no download.
```

- Interceptor: [`src/main.ts:996`](src/main.ts) (`ses.protocol.handle('https', …)`).
- Blob→local mapping + MIME: [`src/asset-sync-manager.ts`](src/asset-sync-manager.ts)
  (`buildBlobLookup`, `getMimeType` — `.mp4 → video/mp4` already present).
- The game just uses the cutscene's **normal blob URL**; web vs. Steam is transparent.

---

## Compression (already done)

Source was 1080p30 H.264 at a wasteful **19.5 Mbps** (642 MB, 4m21s). Re-encoded to
a visually-transparent **4.7 Mbps** → **152 MB (76% smaller)**, with `+faststart`
so it plays before fully buffered.

Compressed file (staged, kept out of the ASAR-bundled `assets/` folder):
`cutscenes/ENTERTIRONA.mp4`

Command used (reuse for future cutscenes — adjust CRF: lower = bigger/better,
higher = smaller; 21 is high quality, 23 ≈ ~100 MB still good):

```bash
ffmpeg -i INPUT.mp4 \
  -c:v libx264 -crf 21 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart \
  OUTPUT.mp4
```

> Stay on **H.264** (not H.265/HEVC): Chromium/Electron can't reliably
> hardware-decode HEVC.

> **Do not** put the video in `assets/` — `electron-builder.yml` bundles
> `assets/**/*` into the ASAR (the ~320 MB **Code** depot). The 642 MB source
> `assets/ENTERTIRONA.mp4` should be deleted or moved once you're happy with the
> compressed copy; both are already gitignored.

---

## Step 1 — Upload the compressed video to Vercel Blob

Path **must** live under `assets/` (that's the only prefix the manifest API scans)
and use a stable name (no random suffix) so the interceptor lookup is predictable.
Target path: **`assets/cutscenes/ENTERTIRONA.mp4`**.

Save this as `Battlemap/scripts/upload-cutscene.ts`:

```ts
import { put } from '@vercel/blob';
import { readFileSync } from 'fs';

const src = process.argv[2];
if (!src) throw new Error('Usage: tsx scripts/upload-cutscene.ts <path-to-mp4>');
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN not set');

const blob = await put('assets/cutscenes/ENTERTIRONA.mp4', readFileSync(src), {
  access: 'public',
  addRandomSuffix: false,   // keep the exact pathname
  contentType: 'video/mp4', // correct type for browser playback on web
});
console.log('Uploaded:', blob.url);
```

Run it from the **Battlemap** repo (its `.env.local` holds `BLOB_READ_WRITE_TOKEN`):

```powershell
# PowerShell, from C:\wireloop\Tirona\Battlemap
$env:BLOB_READ_WRITE_TOKEN = (Select-String -Path .env.local -Pattern '^BLOB_READ_WRITE_TOKEN=').Line -replace '^BLOB_READ_WRITE_TOKEN=',''
npx tsx scripts/upload-cutscene.ts "C:\wireloop\Tirona\electronwrapper\cutscenes\ENTERTIRONA.mp4"
```

Confirm it appears: `npx tsx scripts/upload-assets-to-blob.ts list` — you should see
`assets/cutscenes/ENTERTIRONA.mp4`. Note the printed URL for Step 4 (or resolve it
from the manifest at runtime, recommended below).

---

## Step 2 — Get it into the Steam asset-pack

`scripts/download-asset-pack.ts` only bundles assets listed in the manifest's
`required` array. Choose one:

### Option A (config only — simplest): mark it required
In **Battlemap** `app/api/assets/manifest/route.ts`, add the prefix to
`REQUIRED_ASSET_PREFIXES` (around [line 35](../Battlemap/app/api/assets/manifest/route.ts)):

```ts
const REQUIRED_ASSET_PREFIXES = [
  'assets/monsters/',
  'assets/buildings/',
  'assets/hdri/',
  'assets/cutscenes/',   // ← character-entry cutscene
  'monster_',
  'npc_',
];
```

Deploy Battlemap so the live manifest marks it required.
**Tradeoff:** web (browser) players will pre-download the 152 MB video during the
initial asset-sync, before gameplay.

### Option B (avoid the web pre-download): bundle it explicitly in the wrapper
Leave it **non-required** (skip the manifest edit) and instead bundle it directly.
In this repo, `scripts/download-asset-pack.ts`, right after the `toDownload` line
(~[line 172](scripts/download-asset-pack.ts)):

```ts
const toDownload = manifest.assets.filter((a) => requiredSet.has(a.id));

// Always bundle the character-entry cutscene for the offline Steam build even
// though it's not a "required" web asset (web players stream it on demand).
const EXTRA_BUNDLE_IDS = ['assets/cutscenes/ENTERTIRONA.mp4'];
for (const id of EXTRA_BUNDLE_IDS) {
  const a = manifest.assets.find((x) => x.id === id);
  if (a && !toDownload.some((t) => t.id === id)) toDownload.push(a);
}
```

Web players then stream the cutscene from Vercel Blob only when it plays; Steam
players get it from disk. **Recommended** for the better web experience.

---

## Step 3 — Reference & play the cutscene in the game

On "new character enters the game", play a fullscreen `<video>` pointed at the
cutscene's blob URL. Resolve the URL from the manifest (it changes if you ever
re-upload), so you never hardcode a token:

```tsx
async function getCutsceneUrl(): Promise<string | null> {
  const res = await fetch('/api/assets/manifest');
  const manifest = await res.json();
  return (
    manifest.assets.find(
      (a: { id: string }) => a.id === 'assets/cutscenes/ENTERTIRONA.mp4'
    )?.url ?? null
  );
}

// Render (fullscreen, letterboxed, on top of everything):
// <video
//   src={url}
//   autoPlay
//   playsInline
//   onEnded={handleDone}
//   style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh',
//            objectFit: 'contain', background: '#000', zIndex: 9999 }}
// />
```

- In **Steam**, fetching `manifest…url` (a `*.blob.vercel-storage.com` URL) trips the
  interceptor → served from `asset-pack/` offline. In the **browser**, it streams
  from Blob. No branching needed.
- **Autoplay-with-sound caveat:** browsers block autoplay with audio without prior
  user interaction. Character creation is behind clicks, so it normally works; to be
  safe, start playback inside the click handler that finalizes creation, or catch the
  `video.play()` promise rejection and show a "tap to begin" prompt.

---

## Step 4 — Build & upload to Steam

Only the **Assets** depot (4503862) changes (~+152 MB). Standard pipeline:

```powershell
# from C:\wireloop\Tirona\electronwrapper
npm run download:assets    # pulls the new cutscene into asset-pack/
npm run build
npx electron-builder --win --dir
.\scripts\prepare-steam-upload.ps1 `
  -SdkPath "C:\SteamworksSDK\sdk\tools\ContentBuilder" `
  -Upload -SteamUser wireloopas
# then set the build live in Steamworks > SteamPipe > Builds, and Publish
```

> `download-asset-pack.ts` skips on size-match and never prunes. If you re-encode
> and re-upload to the **same** blob path later, delete
> `asset-pack/assets/cutscenes/ENTERTIRONA.mp4` before `npm run download:assets`.

---

## Step 5 — Verify

1. `npx asar list release\win-unpacked\resources\app.asar | findstr ENTERTIRONA`
   should return **nothing** (it must be in asset-pack, not the ASAR).
2. Confirm the file is in the pack:
   `dir release\win-unpacked\resources\asset-pack\assets\cutscenes\`
3. Run the packaged exe with a `steam_appid.txt` next to it, create a character,
   and watch the console for:
   `[Interceptor] Blob hit: assets/cutscenes/ENTERTIRONA.mp4`
4. **Offline test:** disconnect the network and confirm the cutscene still plays.

---

## Known limitation (optional future enhancement)

The interceptor serves via `fs.readFileSync` + a single `Response` with **no HTTP
Range support** ([`src/main.ts:1008`](src/main.ts)). For a play-once autoplay
cutscene this is fine, but it loads the whole 152 MB into memory per play and
disables seeking. If you later need scrubbing or hit memory hitches, switch the
video branch of the interceptor to a streamed response that honors the `Range`
header (return 206 Partial Content with `Accept-Ranges: bytes`).
