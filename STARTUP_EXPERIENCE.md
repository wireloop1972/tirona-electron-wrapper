# The chronicle in the study

The startup window renders the existing room, table and module book locally in
Three.js. No remote requests are permitted by its Content Security Policy. GLBs
and folios come from the installed scene pack via the restricted `tirona-local:`
protocol; the map, cover and bundled renderer are included in `dist/` by
`scripts/build-startup.cjs`. Existing font files and licences remain packaged.

The narrator choice remains off by default. Opening the book starts the existing
voice preparation IPC when selected. Pages turn at a measured pace without
inventing a completion percentage. On voice completion, the current sheet lands
and remains still through the fade. Written narration, unsupported hardware,
retry, audio failure and diagnostic copying remain available.

`npm run verify:startup` exercises the real renderer in a hidden Electron window,
with simulated voice events. It checks opening, page turning, failure recovery,
successful voice completion mid-turn, and compact layout. It does not initialize
the actual TTS server. Screenshots are saved under `release/startup-review/`.

Run `npm run dev` for an interactive review with the actual narrator service.
`npm run package:steam` runs startup verification and includes the launcher in the
Windows package. No Steam upload or web deployment is triggered by this command.

September 10 landing fix: `src/startup-leaf.mjs` derives curl from the eased
rotation angle, matching the approved menu correction. Previously the curl
outlasted the rotation and pushed the sheet through the resting left page,
briefly exposing the previous image. The updated bounds follow the moving sheet.
`node scripts/check-startup-leaf.cjs` verifies 1,001 poses, no penetration,
coincident printed faces, landing UV alignment and bounds. Build and startup
renderer checks passed. The packaged ASAR differs from the previous Steam
release only in `dist/startup-scene.js`; both GPU variants use that code depot.

Uploaded to Steam App 4503860 on September 10, 2026, without setting a branch
live: default/CUDA BuildID **25230853**, AMD/ROCm BuildID **25230963**. Both use
code manifest **7131159855825769087** (one ASAR changed, approximately 1 MB delta).
The existing asset, static and GPU-specific TTS content was preserved; 409 staged
scene assets passed local alias/Blob routing and SHA-256 checks against their
shipped manifest. No web deployment was performed. The owner will set the builds
live in Steamworks.

September 13: the opening cover now renders its artwork only on its outer face,
with a separate plain paper reverse. Startup renderer checks and the 1,001-pose
leaf check passed. The ASAR comparison against the staged release confirmed that
only `dist/startup-scene.js` changed. The shared in-game menu separately disables
raycasting on hidden illustrated leaves and the decorative book halo.

Both September 13 builds uploaded successfully without SetLive: NVIDIA/CUDA
**25279544**, AMD/ROCm **25279565**. Shared code manifest:
**8100373849883008905**. The web menu fix is live from Battlemap commit
`e6798534` (Vercel deployment `dpl_FPxj9EsDUkLp9mYaMmmnvx3gLQne`).

September 21: the startup book was rebuilt to match the in-game menu's new
module (Battlemap commit `8d934166`). `src/startup-book.mjs` is a plain
Three.js port of `components/charselect/ModuleBook.tsx`: rounded leather boards
with a grain bump map, a spine strip that unrolls as the cover opens so the
front board lands flat on the felt, a page block split into two halves so the
book stands open at its middle with equal stacks meeting in a shaded gutter, and
printed page edges. `src/startup-leaf.mjs` now takes an angle and a resting
profile, with the curl lifting the free corner first; `node
scripts/check-startup-leaf.cjs` verifies 1,001 poses against that profile.
`npm run verify:startup` passed; screenshots under `release/startup-review/`.
Not yet uploaded to Steam.
