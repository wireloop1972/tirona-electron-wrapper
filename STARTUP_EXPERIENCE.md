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
