/** Run with Electron: exercise real HTTPS interception with remote fallback denied. */
const { app, session } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { createHash } = require('crypto');
const { buildSceneLookup, buildBlobLookup, serveSceneAsset } = require('../dist/asset-sync-manager');
const digest = data => createHash('sha256').update(data).digest('hex');

app.whenReady().then(async () => {
  const root = path.resolve(process.argv[2] || 'asset-pack');
  const game = path.resolve(process.env.BATTLEMAP_PATH || '../Battlemap');
  const inventory = JSON.parse(fs.readFileSync(path.join(game, 'data/assets/scene-pack.json')));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  const scenes = buildSceneLookup(manifest, root);
  const blobs = buildBlobLookup(manifest, root);
  const origin = 'https://scene-pack-check.invalid';
  const ses = session.fromPartition('scene-pack-check'); // In-memory, no prior browser cache.
  let denied = 0;
  ses.protocol.handle('https', request => {
    const scene = serveSceneAsset(request.url, origin, scenes);
    if (scene) return scene;
    const file = blobs.get(decodeURIComponent(new URL(request.url).pathname.slice(1)));
    if (file && fs.existsSync(file)) return new Response(fs.readFileSync(file));
    denied++;
    return new Response('Network disabled for packaging verification', { status: 502 });
  });
  let bytes = 0;
  for (const asset of inventory.assets) {
    assert(manifest.required.includes(asset.id), `Not required: ${asset.requestPath}`);
    assert.equal(digest(fs.readFileSync(path.join(game, asset.source))), asset.sha256, 'Source changed');
    const response = await ses.fetch(origin + asset.requestPath);
    assert.equal(response.status, 200, asset.requestPath);
    assert.equal(response.headers.get('X-Tirona-Asset-Source'), 'steam');
    const data = Buffer.from(await response.arrayBuffer());
    assert.equal(data.length, asset.size);
    assert.equal(digest(data), asset.sha256, asset.requestPath);
    // Test actual Blob URL routing as well as the same-origin alias.
    const blobResponse = await ses.fetch(asset.url);
    assert.equal(digest(Buffer.from(await blobResponse.arrayBuffer())), asset.sha256);
    bytes += data.length;
  }
  assert.equal(denied, 0, 'A release request reached the network fallback');
  scenes.set('/models/missing-test.glb', path.join(root, 'intentionally-absent.glb'));
  assert.equal((await ses.fetch(origin + '/models/missing-test.glb')).status, 503);
  assert.equal(denied, 0, 'Missing asset fell through to network');
  assert.equal(serveSceneAsset('https://unrelated.invalid/models/test.glb', origin, scenes), null);
  console.log(`PASS: ${inventory.assets.length} assets, ${bytes} bytes; source/package SHA-256 match; aliases and Blob URLs served locally; missing scene fails closed.`);
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
