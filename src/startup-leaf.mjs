/** Keep the turning sheet above the resting pages all the way through landing. */
export function bendStartupLeaf(geometry, printedUV, width, depth, progress) {
  const t = Math.max(0, Math.min(1, progress));
  const angle = t * t * t * (t * (t * 6 - 15) + 10) * Math.PI;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const u = printedUV.getX(i), x = width * u;
    // Match the approved menu fix: curl settles with rotation, not linear
    // time. The old curl outlasted rotation and exposed the page underneath.
    const bend = Math.sin(u * Math.PI) * Math.min(.18, width / Math.PI);
    const curl = sin * bend;
    positions.setXYZ(i, x * cos - curl * sin, x * sin + curl * cos, (.5 - printedUV.getY(i)) * depth);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}
