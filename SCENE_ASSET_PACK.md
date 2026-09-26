# Study, travel and encounter scene packaging

The sibling Battlemap `data/assets/scene-pack.json` inventory is required for Steam
packaging. Set `BATTLEMAP_PATH` if that checkout is elsewhere. Use the matching game
revision; changed source hashes stop the build until the scene inventory is refreshed.

`npm run package:steam` now:

1. Compiles Electron.
2. Loads the production legacy manifest and merges the explicit scene inventory.
3. Downloads optimized scene files from their immutable Blob URLs into `asset-pack/<id>` and verifies SHA-256. Battlemap supplies metadata, not asset bytes.
4. Tests HTTPS aliases and Blob URLs in an empty Electron session with networking denied.
5. Refreshes the existing static texture/HDR pack and packages Windows.
6. Repeats scene verification against `release/win-unpacked/resources/asset-pack`.

No scene is selected by basename or by guessing the smallest GLB. Keep the full
manifest ID. There are multiple unrelated `terrain.glb` and `diorama.glb` files.
Never package `importassets/` originals or re-run asset optimization during packaging.

Game loaders resolve scene aliases directly to Blob URLs, which Electron serves
from the installed asset pack. Same-origin `/models/...` aliases remain supported.
Missing registered package files return an installation error. New Blob URLs absent
from the installed manifest may download once into the existing IndexedDB cache.
Geometry/layout JSON
and module illustrations are included alongside the GLBs. Textures remain in static-pack.

Use `npm run verify:scenes` and `npm run verify:packaged-scenes` independently when
reviewing an existing build. The checks compare source and packaged bytes to the
inventory SHA-256 and explicitly test missing-file behavior.

Release code depot 4503861, assets depot 4503862 and static depot 4503864 together.
Only then deploy the matching Battlemap web manifest/redirect changes. Building a
package does not upload or activate a Steam release.

Uploaded to Steam App 4503860 on September 25, 2026, without setting a branch
live: default/CUDA BuildID **25531202**, AMD/ROCm BuildID **25531334** (VDFs
`app_build_premiumminis.vdf` / `app_build_premiumminis_amd.vdf`). The asset pack
adds the 42 premium player miniatures (Battlemap 83199b52: GLB + preview each,
84 scene entries). `package:steam` ran end to end: 555 scene assets
(1,353,353,208 bytes) verified before and after packaging, startup checks passed.
Only the assets depot changed: **6997008876464263611** (344 files added, 207 MB).
Code **6794619529775231182**, static **8345576566869889997** and TTS CUDA
**6940562104205002231** were reused; TTS ROCm re-uploaded unchanged content as
**6966641965853334645** (21 chunks). Pack version 1f12edc80f05b369, 766 required
assets. The owner sets the builds live in Steamworks.

Uploaded to Steam App 4503860 on September 26, 2026, without setting a branch
live: default/CUDA BuildID **25544596**, AMD/ROCm BuildID **25544649** (VDFs
`app_build_introfilm.vdf` / `app_build_introfilm_amd.vdf`). The asset pack now
bundles the intro film `assets/cutscenes/ENTERTIRONA-3.mp4` (241,481,210 bytes,
SHA-256 92935ba4…) so it plays offline; `download-asset-pack.ts` reads the film id
from Battlemap `components/game/IntroCutscene.tsx` (`CUTSCENE_ASSET_ID`). Packaged
video/audio is served with HTTP byte ranges (`servePackagedMedia`); GLBs and other
assets are served exactly as before. `package:steam` now also runs
`verify:intro-film` / `verify:packaged-intro-film` (the film plays and seeks in an
offline Electron window). Code **3740570716572669870** and assets
**4124457343893932669** (2 files added, 230 MB) are new; TTS CUDA
**6940562104205002231** and static **8345576566869889997** were reused; TTS ROCm
re-uploaded unchanged content as **6994371129280619877**. Pack version
06304875b85df98e. The owner sets the builds live in Steamworks.
