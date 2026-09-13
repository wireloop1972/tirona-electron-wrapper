const assert = require('node:assert/strict');
const path = require('node:path');
const THREE = require(path.resolve(process.env.BATTLEMAP_PATH || '../Battlemap', 'node_modules/three'));

(async () => {
  const { bendStartupLeaf } = await import('../src/startup-leaf.mjs');
  const width = 1.42, depth = 2.12;
  const front = new THREE.PlaneGeometry(width, depth, 40, 8), back = front.clone();
  for (let i = 0; i < back.attributes.uv.count; i++) back.attributes.uv.setX(i, 1 - back.attributes.uv.getX(i));
  const point = new THREE.Vector3();
  for (let frame = 0; frame <= 1000; frame++) {
    const t = frame / 1000;
    for (const geometry of [front, back]) {
      bendStartupLeaf(geometry, front.attributes.uv, width, depth, t);
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        point.fromBufferAttribute(geometry.attributes.position, i);
        assert(point.y >= -1e-6, `Page penetration at t=${t}, vertex=${i}`);
        assert(point.distanceTo(geometry.boundingSphere.center) <= geometry.boundingSphere.radius + 1e-6);
        assert(Math.abs(point.x - front.attributes.position.getX(i)) < 1e-6);
        assert(Math.abs(point.y - front.attributes.position.getY(i)) < 1e-6);
        if (frame === 0 || frame === 1000) assert(Math.abs(point.y) < 1e-6, 'Endpoints must be flat');
        if (frame === 1000) assert(Math.abs(back.attributes.uv.getX(i) - (point.x + width) / width) < 1e-6, 'Landing artwork must align');
      }
    }
  }
  front.dispose(); back.dispose();
  console.log('PASS: 1,001 startup leaf poses, no page penetration, aligned faces/landing UVs and valid bounds.');
})().catch(error => { console.error(error); process.exitCode = 1; });
