const assert = require('node:assert/strict');
const path = require('node:path');
const THREE = require(path.resolve(process.env.BATTLEMAP_PATH || '../Battlemap', 'node_modules/three'));

(async () => {
  const { bendStartupLeaf, turnEase } = await import('../src/startup-leaf.mjs');
  const width = 1.42, depth = 2.12;
  const front = new THREE.PlaneGeometry(width, depth, 40, 8);
  front.rotateX(-Math.PI / 2); front.translate(width / 2, 0, 0);
  const back = front.clone();
  for (let i = 0; i < back.attributes.uv.count; i++) back.attributes.uv.setX(i, 1 - back.attributes.uv.getX(i));
  // The sheet's rest at full open: a hair above the page, sagging into the
  // gutter either side of the fold, the way startup-book.mjs shapes it.
  const lift = 0.012 * (width / 4.2), gutterDepth = 0.06 * (width / 4.2), gutterHalf = 0.08;
  const rest = x => { const q = Math.min(1, Math.abs(x) / gutterHalf); return lift - gutterDepth * (1 - q * q * q * (q * (q * 6 - 15) + 10)); };
  const point = new THREE.Vector3();
  for (let frame = 0; frame <= 1000; frame++) {
    const t = frame / 1000, angle = Math.PI * turnEase(t), cos = Math.cos(angle);
    for (const geometry of [front, back]) {
      bendStartupLeaf(geometry, front.attributes.uv, width, depth, angle, rest);
      for (let i = 0; i < geometry.attributes.position.count; i++) {
        point.fromBufferAttribute(geometry.attributes.position, i);
        const x = width * front.attributes.uv.getX(i);
        assert(point.y >= rest(x * cos) - 1e-6, `Page penetration at t=${t}, vertex=${i}`);
        assert(point.distanceTo(geometry.boundingSphere.center) <= geometry.boundingSphere.radius + 1e-6);
        assert(Math.abs(point.x - front.attributes.position.getX(i)) < 1e-6);
        assert(Math.abs(point.y - front.attributes.position.getY(i)) < 1e-6);
        if (frame === 0 || frame === 1000) {
          const expectedX = x * (frame === 0 ? 1 : -1);
          assert(Math.abs(point.x - expectedX) < 1e-6);
          assert(Math.abs(point.y - rest(expectedX)) < 1e-6, 'Endpoints must lie on the resting profile');
        }
        if (frame === 1000) assert(Math.abs(back.attributes.uv.getX(i) - (point.x + width) / width) < 1e-6, 'Landing artwork must align');
      }
    }
  }
  front.dispose(); back.dispose();
  console.log('PASS: 1,001 startup leaf poses, no page penetration, aligned faces/landing UVs and valid bounds.');
})().catch(error => { console.error(error); process.exitCode = 1; });
