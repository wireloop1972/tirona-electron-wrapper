/** Run with Electron: the packaged intro film must PLAY offline through the real interceptor
 *  helpers, with byte ranges, and seek. Network is denied; any request that is not served from
 *  the pack fails the check.
 *    electron scripts/check-intro-film.cjs [asset-pack dir]
 */
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { buildBlobLookup, isPackagedMedia, servePackagedMedia } = require('../dist/asset-sync-manager');

app.whenReady().then(async () => {
  const root = path.resolve(process.argv[2] || 'asset-pack');
  const game = path.resolve(process.env.BATTLEMAP_PATH || '../Battlemap');
  const id = fs.readFileSync(path.join(game, 'components/game/IntroCutscene.tsx'), 'utf8').match(/CUTSCENE_ASSET_ID = '([^']+)'/)[1];
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  const entry = manifest.assets.find((a) => a.id === id);
  assert(entry, `Intro film ${id} absent from the packaged manifest`);
  const file = path.join(root, id);
  assert(fs.existsSync(file), `Intro film missing from the pack: ${file}`);
  assert.equal(fs.statSync(file).size, entry.size, 'Packaged intro film size differs from the manifest');

  const blobs = buildBlobLookup(manifest, root);
  const ses = session.fromPartition('intro-film-check');
  let denied = 0;
  let ranged = 0;
  ses.protocol.handle('https', (request) => {
    const local = blobs.get(decodeURIComponent(new URL(request.url).pathname.slice(1)));
    if (local && fs.existsSync(local) && isPackagedMedia(local)) {
      if (request.headers.get('range')) ranged++;
      return servePackagedMedia(request, local);
    }
    denied++;
    return new Response('Network disabled for packaging verification', { status: 502 });
  });

  // Range semantics, directly
  const probe = await ses.fetch(entry.url, { headers: { Range: 'bytes=100-199' } });
  assert.equal(probe.status, 206);
  assert.equal(probe.headers.get('content-range'), `bytes 100-199/${entry.size}`);
  const want = Buffer.alloc(100);
  const fd = fs.openSync(file, 'r'); fs.readSync(fd, want, 0, 100, 100); fs.closeSync(fd);
  assert.deepEqual(Buffer.from(await probe.arrayBuffer()), want, 'Range bytes differ from the file');

  // Real playback in a page, with seeking
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, autoplayPolicy: 'no-user-gesture-required' } });
  await win.loadURL('data:text/html,<video id=v muted preload=auto></video>');
  const result = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const v = document.getElementById('v');
    const fail = (why) => resolve({ ok: false, why, t: v.currentTime, d: v.duration });
    v.onerror = () => fail('media error ' + (v.error && v.error.code));
    setTimeout(() => fail('timeout'), 60000);
    v.src = ${JSON.stringify(entry.url)};
    v.play().catch((e) => fail('play: ' + e.message));
    const waitFor = (test, then) => { const i = setInterval(() => { if (test()) { clearInterval(i); then(); } }, 100); };
    waitFor(() => v.currentTime > 2, () => {
      const played = v.currentTime;
      v.currentTime = 200;
      waitFor(() => v.currentTime > 201, () => resolve({ ok: true, played, seeked: v.currentTime, d: v.duration, w: v.videoWidth, h: v.videoHeight }));
    });
  })`);
  assert(result.ok, `Intro film did not play offline: ${JSON.stringify(result)}`);
  assert(Math.abs(result.d - 259.88) < 0.2, `Unexpected duration ${result.d}`);
  assert.equal(denied, 0, 'A request for the intro film reached the network fallback');
  assert(ranged > 0, 'The video element made no range requests');
  console.log(`PASS: ${id} (${entry.size} bytes) played offline from the pack: ${result.w}x${result.h}, ` +
    `${result.d.toFixed(2)} s, played past ${result.played.toFixed(1)} s, seeked to ${result.seeked.toFixed(1)} s; ` +
    `${ranged} range requests, 0 network.`);
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
