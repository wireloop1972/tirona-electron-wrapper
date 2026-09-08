# Tirona production asset delivery

- GLBs are published to Vercel Blob. Steam packages download their bytes from Blob; the sibling Battlemap repository supplies release metadata, not asset bytes.
- Preserve immutable URLs, asset IDs, SHA-256 and inventory coverage. Packaged assets must resolve to disk without downloading them again from the Vercel application server or Blob.
- New Blob assets between Steam releases must be allowed through to the persistent cache. Do not reject every URL absent from the installed manifest. A known packaged file missing from disk is a damaged-installation error.
- The approved between-release cache is IndexedDB, used by the web app inside Electron. Preserve this persistent cache and reuse unchanged assets across launches; no SQLite migration is required.
- Never introduce `public/models` copies or application-hosted GLB fallbacks. The canonical game instructions are in `../Battlemap/AGENTS.md` and the release contract is in `../Battlemap/docs/design/scene-pack-release.md`.
- Before releasing asset changes, run `npm run download:assets` and `npm run verify:scenes`. Ship the compatible Steam code and asset depots before the corresponding web release. Local packaging is not a Steam deployment.
