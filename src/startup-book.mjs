/**
 * The Stonebrook module for the startup window: the same case binding the
 * in-game menu draws (Battlemap components/charselect/ModuleBook.tsx), in
 * plain Three.js with no React. Sizes are scaled from the menu's 4.2-wide
 * book so every proportion matches.
 *
 * Closed: two rounded leather boards, a page block, a rounded spine strip.
 * Opening: the strip unrolls so the front board lands flat, carrying the
 * upper half of the block with it — the book stands open at its middle,
 * two equal stacks meeting in a shaded gutter. The left page rides on the
 * underside of the upper half; the right page and the turning sheet lie on
 * the lower half.
 */
import { bendStartupLeaf, shadeGutter } from './startup-leaf.mjs';

const LEATHER = '#4a2c18';
const LEATHER_SPINE = '#3a2110';
const BLOCK_BACKING = '#5a3a20';
const STACK_PAPER = '#e2c994';
const PASTE_DOWN = '#c3ab86';
const PAPER = '#fff6df';
const STRIP_SEGMENTS = 24;

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvasTexture(THREE, w, h, draw, configure) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(canvas);
  configure(t);
  t.needsUpdate = true;
  return t;
}

/** Leather grain as a bump map: fine pebbling under a slower mottle. */
function leatherGrain(THREE) {
  return canvasTexture(THREE, 256, 256, (ctx, w, h) => {
    const rand = lcg(7);
    const image = ctx.createImageData(w, h), d = image.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const mottle = Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) * Math.cos(y * 0.09 + Math.sin(x * 0.05) * 2);
      const v = 128 + mottle * 26 + (rand() - 0.5) * 70;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v)); d[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 4); });
}

/** The cut edges of a stack: each leaf a light line over a dark seam. */
function pageEdges(THREE) {
  return canvasTexture(THREE, 128, 256, (ctx, w, h) => {
    const rand = lcg(11);
    ctx.fillStyle = '#e9d9b3'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      const a = y % 2 === 0 ? 0.28 + rand() * 0.3 : rand() * 0.08;
      ctx.fillStyle = `rgba(78, 54, 24, ${a})`; ctx.fillRect(0, y, w, 1);
    }
    for (let x = 0; x < w; x++) {
      const a = (Math.sin(x * 0.19) * 0.5 + 0.5) * 0.14 + rand() * 0.04;
      ctx.fillStyle = `rgba(120, 84, 40, ${a})`; ctx.fillRect(x, 0, 1, h);
    }
  }, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(3, 1); });
}

/**
 * @param THREE the three module
 * @param options { width, depth, coverTexture, RoundedBoxGeometry }
 * @returns { group, materials, sheet, setOpen, setTurn, geometry }
 *   materials = [left page, right page, sheet front, sheet back];
 *   setOpen(0..1) drives the cover, setTurn(angle) the sheet.
 */
export function createStartupBook(THREE, { width, depth, coverTexture, RoundedBoxGeometry }) {
  const s = width / 4.2;
  const G = {
    square: 0.045 * s,
    board: 0.055 * s,
    block: 0.3 * s,
    radius: 0.012 * s,
    joint: 0.02 * s,
    closedTurn: Math.PI / 2,
  };
  G.blockTop = G.board + G.block;
  G.spine = (G.blockTop * G.closedTurn) / (2 * Math.sin(G.closedTurn / 2));
  G.hingeX = -width / 2 - G.square;
  G.stack = G.block / 2;
  G.stackTop = G.board + G.stack;
  G.openHingeX = G.hingeX + G.joint - G.spine;
  G.openFoldX = G.openHingeX + G.spine / 2;
  G.closedFoldX = -width / 2 + 0.04 * s;
  const BOARD_W = width + G.square * 2, BOARD_D = depth + G.square * 2;

  const grain = leatherGrain(THREE);
  const edges = pageEdges(THREE);
  const leather = (color, roughness = 0.7) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04, bumpMap: grain, bumpScale: 0.6 * s });
  const group = new THREE.Group();

  // ── Strip shape (see ModuleBook.tsx stripShape / stripPoint) ───────────
  const stripShape = open => {
    const turn = G.closedTurn * (1 - open);
    const heading = THREE.MathUtils.lerp(Math.PI / 2 + G.closedTurn / 2, Math.PI, open);
    return { turn, heading, radius: turn < 1e-4 ? 0 : G.spine / turn };
  };
  const stripPoint = ({ turn, heading, radius }, f, out) => {
    const ax = G.hingeX + G.joint, ay = G.board / 2;
    if (radius === 0) {
      out.x = ax + Math.cos(heading) * G.spine * f; out.y = ay + Math.sin(heading) * G.spine * f;
    } else {
      const a = turn * f;
      out.x = ax + radius * (Math.sin(heading) - Math.sin(heading - a));
      out.y = ay + radius * (Math.cos(heading - a) - Math.cos(heading));
    }
    const h = heading - turn * f;
    out.nx = -Math.sin(h); out.ny = Math.cos(h);
    return out;
  };

  // ── Back board + lower stack ────────────────────────────────────────────
  const halfBlock = () => {
    const edge = new THREE.MeshStandardMaterial({ map: edges, roughness: 0.92 });
    const paper = new THREE.MeshStandardMaterial({ color: STACK_PAPER, roughness: 0.95 });
    const backing = new THREE.MeshStandardMaterial({ color: BLOCK_BACKING, roughness: 0.85 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(width, G.stack, depth), [edge, backing, paper, paper, edge, edge]);
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const backBoard = new THREE.Mesh(new RoundedBoxGeometry(BOARD_W, G.board, BOARD_D, 3, G.radius), leather(LEATHER));
  backBoard.position.y = G.board / 2; backBoard.castShadow = backBoard.receiveShadow = true;
  group.add(backBoard);
  const lower = halfBlock(); lower.position.y = G.board + G.stack / 2; group.add(lower);

  // ── Spine strip ─────────────────────────────────────────────────────────
  const n = STRIP_SEGMENTS + 1;
  const stripGeometry = new THREE.BufferGeometry();
  stripGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
  const uv = new Float32Array(n * 4 * 2);
  for (let i = 0; i < n; i++) { const u = i / STRIP_SEGMENTS; uv.set([u, 0, u, 1, u, 0, u, 1], i * 8); }
  stripGeometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const index = [];
  for (let i = 0; i < STRIP_SEGMENTS; i++) {
    const b = i * 4, c = b + 4;
    const [oF, oN, iF, iN] = [b, b + 1, b + 2, b + 3], [oF1, oN1, iF1, iN1] = [c, c + 1, c + 2, c + 3];
    index.push(oF, oN, oN1, oF, oN1, oF1, iF, iN1, iN, iF, iF1, iN1, oF, iF1, iF, oF, oF1, iF1, oN, iN, iN1, oN, iN1, oN1);
  }
  stripGeometry.setIndex(index);
  const strip = new THREE.Mesh(stripGeometry, leather(LEATHER_SPINE, 0.66));
  strip.castShadow = strip.receiveShadow = true; group.add(strip);
  const point = { x: 0, y: 0, nx: 0, ny: 0 };
  const rebuildStrip = open => {
    const shape = stripShape(open), half = G.board / 2, L = BOARD_D;
    const p = stripGeometry.attributes.position;
    for (let i = 0; i <= STRIP_SEGMENTS; i++) {
      const { x, y, nx, ny } = stripPoint(shape, i / STRIP_SEGMENTS, point), b = i * 4;
      p.setXYZ(b, x + nx * half, y + ny * half, -L / 2); p.setXYZ(b + 1, x + nx * half, y + ny * half, L / 2);
      p.setXYZ(b + 2, x - nx * half, y - ny * half, -L / 2); p.setXYZ(b + 3, x - nx * half, y - ny * half, L / 2);
    }
    p.needsUpdate = true; stripGeometry.computeVertexNormals(); stripGeometry.computeBoundingSphere();
  };

  // ── Front board, upper stack, cover art, paste-down ─────────────────────
  const cover = new THREE.Group(); group.add(cover);
  const centreX = BOARD_W / 2 - G.joint;
  const frontBoard = new THREE.Mesh(new RoundedBoxGeometry(BOARD_W, G.board, BOARD_D, 3, G.radius), leather(LEATHER));
  frontBoard.position.x = centreX; frontBoard.castShadow = frontBoard.receiveShadow = true; cover.add(frontBoard);
  const upper = halfBlock(); upper.position.set(width / 2 + G.square - G.joint, -G.board / 2 - G.stack / 2, 0); cover.add(upper);
  const lining = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W - 0.08 * s, BOARD_D - 0.08 * s),
    new THREE.MeshStandardMaterial({ color: PASTE_DOWN, roughness: 0.95 }));
  lining.rotation.x = Math.PI / 2; lining.position.set(centreX, -G.board / 2 - 0.001 * s, 0); cover.add(lining);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.08 * s, depth - 0.08 * s),
    new THREE.MeshStandardMaterial({ map: coverTexture, roughness: 0.62, metalness: 0.02 }));
  art.rotation.x = -Math.PI / 2; art.position.set(centreX, G.board / 2 + 0.002 * s, 0); cover.add(art);

  // ── Pages ───────────────────────────────────────────────────────────────
  const W = width - 0.06 * s, D = depth - 0.12 * s;
  const LIFT = 0.006 * s, SHEET_REST = 0.012 * s, GUTTER_DEPTH = 0.06 * s;
  const GUTTER_HALF = G.spine / 2 + G.joint + 0.005 * s;
  const paperWidth = open => THREE.MathUtils.lerp(W, W + (G.closedFoldX - G.openFoldX), open);
  const gutterProfile = (open, lift) => {
    const depthNow = GUTTER_DEPTH * THREE.MathUtils.smoothstep(open, 0.85, 1);
    return x => { const q = Math.min(1, Math.abs(x) / GUTTER_HALF); return lift - depthNow * (1 - q * q * q * (q * (q * 6 - 15) + 10)); };
  };
  const leaf = () => {
    const g = new THREE.PlaneGeometry(W, D, 40, 8); g.rotateX(-Math.PI / 2); g.translate(W / 2, 0, 0);
    shadeGutter(THREE, g, g.attributes.uv, W, s); return g;
  };
  const flip = front => { const g = front.clone(); const u = g.attributes.uv; for (let i = 0; i < u.count; i++) u.setX(i, 1 - u.getX(i)); return g; };
  const sheetFront = leaf(), sheetBack = flip(sheetFront), page = leaf(), left = flip(sheetFront);
  const paperMaterial = side => new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.96, vertexColors: true, side });
  const materials = [paperMaterial(THREE.DoubleSide), paperMaterial(THREE.FrontSide), paperMaterial(THREE.FrontSide), paperMaterial(THREE.BackSide)];
  const leftMesh = new THREE.Mesh(left, materials[0]); cover.add(leftMesh);
  const pages = new THREE.Group(); pages.position.set(G.closedFoldX, G.stackTop + LIFT, 0); group.add(pages);
  pages.add(new THREE.Mesh(page, materials[1]));
  const sheet = new THREE.Group(); pages.add(sheet);
  const sheetMeshes = [new THREE.Mesh(sheetFront, materials[2]), new THREE.Mesh(sheetBack, materials[3])];
  sheetMeshes.forEach(m => { m.castShadow = true; sheet.add(m); });

  const shapeLeft = open => {
    bendStartupLeaf(left, sheetFront.attributes.uv, paperWidth(open), D, Math.PI, gutterProfile(open, 0));
    const slide = THREE.MathUtils.lerp(G.spine / 2 + (G.closedFoldX + width / 2), 0, open);
    const p = left.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, -G.spine / 2 - p.getX(i) + slide, G.board / 2 - (G.stackTop + LIFT + p.getY(i)), p.getZ(i));
    }
    p.needsUpdate = true; left.computeVertexNormals(); left.computeBoundingSphere();
  };

  let lastOpen = NaN, lastAngle = NaN;
  const setOpen = open => {
    if (open === lastOpen) return;
    lastOpen = open; lastAngle = NaN;
    rebuildStrip(open);
    const hinge = stripPoint(stripShape(open), 1, point);
    cover.position.set(hinge.x, hinge.y, 0); cover.rotation.z = open * Math.PI;
    pages.position.x = THREE.MathUtils.lerp(G.closedFoldX, G.openFoldX, open);
    bendStartupLeaf(page, page.attributes.uv, paperWidth(open), D, 0, gutterProfile(open, 0));
    shapeLeft(open);
  };
  const setTurn = angle => {
    if (angle === lastAngle) return;
    lastAngle = angle;
    const rest = gutterProfile(lastOpen, SHEET_REST);
    for (const g of [sheetFront, sheetBack]) bendStartupLeaf(g, sheetFront.attributes.uv, paperWidth(lastOpen), D, angle, rest);
  };
  setOpen(0); setTurn(0);

  return { group, materials, sheet, setOpen, setTurn, geometry: G, sheetGeometry: sheetFront };
}
