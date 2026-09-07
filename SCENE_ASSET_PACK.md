# Study, travel and encounter scene packaging

The sibling Battlemap `data/assets/scene-pack.json` inventory is required for Steam
packaging. Set `BATTLEMAP_PATH` if that checkout is elsewhere. Use the matching game
revision; changed source hashes stop the build until the scene inventory is refreshed.

`npm run package:steam` now:

1. Compiles Electron.
2. Loads the production legacy manifest and merges the explicit scene inventory.
3. Copies SHA-256-verified optimized scene files from Battlemap into `asset-pack/<id>`.
4. Tests HTTPS aliases and Blob URLs in an empty Electron session with networking denied.
5. Refreshes the existing static texture/HDR pack and packages Windows.
6. Repeats scene verification against `release/win-unpacked/resources/asset-pack`.

No scene is selected by basename or by guessing the smallest GLB. Keep the full
manifest ID. There are multiple unrelated `terrain.glb` and `diorama.glb` files.
Never package `importassets/` originals or re-run asset optimization during packaging.

Same-origin `/models/...` aliases resolve to the installed asset pack before the web
redirect to Blob. Missing registered scenes return an explicit error rather than a
network download. Existing Blob interception remains supported. Geometry/layout JSON
and module illustrations are included alongside the GLBs. Textures remain in static-pack.

Use `npm run verify:scenes` and `npm run verify:packaged-scenes` independently when
reviewing an existing build. The checks compare source and packaged bytes to the
inventory SHA-256 and explicitly test missing-file behavior.

Release code depot 4503861, assets depot 4503862 and static depot 4503864 together.
Only then deploy the matching Battlemap web manifest/redirect changes. Building a
package does not upload or activate a Steam release.
