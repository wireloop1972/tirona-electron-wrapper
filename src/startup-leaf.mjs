/**
 * Leaf maths for the startup book, matching the in-game menu
 * (Battlemap components/charselect/leafGeometry.ts).
 */

/** Smootherstep — the ease a page turn runs on. */
export function turnEase(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * u * (u * (u * 6 - 15) + 10);
}

/**
 * Bend a leaf hinged at x = 0 to `angle` radians (0 = flat on the right,
 * π = flat on the left), settling it onto `rest(x)` at either end. The curl
 * is asymmetric — the free corner lifts first — and bounded so the paper
 * never dips through the fold line: y = sin(a)·(x + bend·cos(a)) stays ≥ 0
 * while bend ≤ x, which holds for bend = amp·sin(π·u^k) with k ≥ 1 and
 * amp ≤ width/π. The fold keeps its own height throughout; the rest of the
 * profile applies only when the leaf is lying down.
 */
export function bendStartupLeaf(geometry, printedUV, width, depth, angle, rest) {
  const a = Math.max(0, Math.min(Math.PI, angle));
  const sin = Math.sin(a), cos = Math.cos(a);
  const amp = Math.min(width * 0.12, width / Math.PI);
  const k = 1 + 0.5 * (1 - a / Math.PI);
  const fold = rest(0);
  const settle = cos * cos;
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const u = printedUV.getX(i), x = width * u;
    const curl = sin * amp * Math.sin(Math.PI * Math.pow(u, k));
    positions.setXYZ(
      i,
      x * cos - curl * sin,
      x * sin + curl * cos + fold + settle * (rest(x * cos) - fold),
      (0.5 - printedUV.getY(i)) * depth,
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

/**
 * Gutter shading as vertex colours: paper darkens as it curves into the
 * binding, keyed on distance from the fold so a leaf reads the same on
 * either page. `scale` is this book's size relative to the menu's.
 */
export function shadeGutter(THREE, geometry, printedUV, width, scale) {
  const count = printedUV.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = width * printedUV.getX(i);
    const shade = 1 - 0.45 * Math.exp(-x / (0.6 * scale));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
