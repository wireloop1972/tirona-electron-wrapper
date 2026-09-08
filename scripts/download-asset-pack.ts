#!/usr/bin/env ts-node
/**
 * Build-time script: download all required game assets from the
 * production manifest API and save them into ./asset-pack/ so they
 * can be bundled with the Steam/Electron build.
 *
 * Usage:
 *   npx ts-node scripts/download-asset-pack.ts
 *   npm run download:assets
 *
 * Options (env vars):
 *   MANIFEST_URL  – override the manifest endpoint
 *   OUTPUT_DIR    – override the output directory  (default: ./asset-pack)
 *   CONCURRENCY   – parallel download limit        (default: 6)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { createHash } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

interface AssetEntry {
  id: string;
  url: string;
  hash: string;
  size: number;
  category: 'glb' | 'hdri' | 'texture' | 'other';
  sha256?: string;
  requestPath?: string;
  source?: string;
}

interface AssetManifest {
  assetPackVersion: string;
  generatedAt: string;
  required: string[];
  assets: AssetEntry[];
  backgroundImageUrl?: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

const MANIFEST_URL =
  process.env.MANIFEST_URL ??
  'https://tironabattlemap.vercel.app/api/assets/manifest';

const OUTPUT_DIR = path.resolve(
  process.env.OUTPUT_DIR ?? path.join(__dirname, '..', 'asset-pack')
);

const CONCURRENCY = Number(process.env.CONCURRENCY ?? '6');
const BATTLEMAP_DIR = path.resolve(process.env.BATTLEMAP_PATH ?? path.join(__dirname, '..', '..', 'Battlemap'));
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const safePath = (root: string, relative: string) => {
  const target = path.resolve(root, relative);
  const within = path.relative(root, target);
  if (within.startsWith('..') || path.isAbsolute(within)) throw new Error(`Unsafe asset path: ${relative}`);
  return target;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const fetchJson = (url: string): Promise<AssetManifest> =>
  new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });

const downloadFile = (
  url: string,
  dest: string,
  expectedSize: number
): Promise<void> =>
  new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (loc) {
          downloadFile(loc, dest, expectedSize).then(resolve, reject);
          res.resume();
          return;
        }
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }

      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => {
        ws.close();
        const stat = fs.statSync(dest);
        if (expectedSize > 0 && stat.size !== expectedSize) {
          reject(
            new Error(
              `Size mismatch for ${path.basename(dest)}: ` +
              `expected ${expectedSize}, got ${stat.size}`
            )
          );
        } else {
          resolve();
        }
      });
      ws.on('error', reject);
    }).on('error', reject);
  });

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const runPool = async <T>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<void>
): Promise<void> => {
  let idx = 0;
  const next = async (): Promise<void> => {
    const i = idx++;
    if (i >= items.length) return;
    await fn(items[i], i);
    await next();
  };
  await Promise.all(Array.from({ length: concurrency }, () => next()));
};

// ── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Tirona Asset Pack Download Script      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Manifest URL : ${MANIFEST_URL}`);
  console.log(`Output dir   : ${OUTPUT_DIR}`);
  console.log(`Concurrency  : ${CONCURRENCY}`);
  console.log();

  // 1. Fetch manifest
  console.log('Fetching manifest...');
  const manifest = await fetchJson(MANIFEST_URL);
  // The sibling release inventory is authoritative even before the web deployment.
  // Fetch bytes from Blob; the sibling repository supplies release metadata only.
  const sceneInventoryPath = path.join(BATTLEMAP_DIR, 'data/assets/scene-pack.json');
  if (!fs.existsSync(sceneInventoryPath)) throw new Error(`Missing scene release inventory: ${sceneInventoryPath}`);
  const sceneInventory = JSON.parse(fs.readFileSync(sceneInventoryPath, 'utf8')) as { assets: AssetEntry[] };
  const sceneIds = new Set(sceneInventory.assets.map(a => a.id));
  manifest.assets = [...manifest.assets.filter(a => !a.id.startsWith('assets/scenes/')), ...sceneInventory.assets];
  manifest.required = [...new Set([...manifest.required.filter(id => !id.startsWith('assets/scenes/')), ...sceneIds])];
  manifest.assetPackVersion = createHash('sha256').update(manifest.assets.map(a => a.hash).sort().join('')).digest('hex').slice(0, 16);
  manifest.generatedAt = new Date().toISOString();
  console.log(
    `  Version    : ${manifest.assetPackVersion}`
  );
  console.log(
    `  Generated  : ${manifest.generatedAt}`
  );
  console.log(
    `  Total assets: ${manifest.assets.length}`
  );
  console.log(
    `  Required   : ${manifest.required.length}`
  );
  console.log();

  // 2. Filter to required assets only
  const requiredSet = new Set(manifest.required);
  for (const id of requiredSet) {
    if (!manifest.assets.some(a => a.id === id)) throw new Error(`Required asset absent from manifest: ${id}`);
  }
  const required = manifest.assets.filter((a) => requiredSet.has(a.id));

  // The manifest can list one id twice: a legacy blob still carrying its upload
  // suffix ('monster_cage__211-68t4ngOo....glb') alongside the re-encoded
  // canonical upload ('monster_cage__211.glb'). Both resolve to the same dest
  // path below, so downloading both races two write streams onto one file and
  // leaves a silently corrupt asset whose size is nondeterministic. Keep a
  // single entry per id: prefer the URL whose filename is exactly the id (the
  // canonical re-encode), then the smaller file.
  const fileNameOf = (a: AssetEntry): string =>
    decodeURIComponent((a.url.split('/').pop() ?? '').split('?')[0]);
  const isCanonical = (a: AssetEntry): boolean => fileNameOf(a) === a.id;

  const byId = new Map<string, AssetEntry>();
  const deduped: string[] = [];
  for (const a of required) {
    const seen = byId.get(a.id);
    if (!seen) {
      byId.set(a.id, a);
      continue;
    }
    if ((a.sha256 || seen.sha256) && a.sha256 !== seen.sha256) throw new Error(`Conflicting asset hashes: ${a.id}`);
    const keep =
      isCanonical(a) !== isCanonical(seen)
        ? (isCanonical(a) ? a : seen)
        : (a.size <= seen.size ? a : seen);
    const drop = keep === a ? seen : a;
    byId.set(a.id, keep);
    deduped.push(
      `${a.id}: kept ${fileNameOf(keep)} (${formatBytes(keep.size)}), ` +
      `dropped ${fileNameOf(drop)} (${formatBytes(drop.size)})`
    );
  }

  const toDownload = [...byId.values()];
  if (deduped.length > 0) {
    console.log(`  Deduped ${deduped.length} duplicate id(s) in the manifest:`);
    for (const d of deduped) console.log(`    - ${d}`);
    console.log();
  }

  const totalBytes = toDownload.reduce((sum, a) => sum + a.size, 0);

  console.log(
    `Downloading ${toDownload.length} required assets ` +
    `(${formatBytes(totalBytes)})...`
  );
  console.log();

  // 3. Ensure output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 4. Save manifest
  const manifestDest = path.join(OUTPUT_DIR, 'manifest.json');

  // 5. Download assets with concurrency pool
  let completed = 0;
  let failed = 0;
  let downloadedBytes = 0;
  const errors: string[] = [];

  await runPool(toDownload, CONCURRENCY, async (asset, _i) => {
    const dest = safePath(OUTPUT_DIR, asset.id);

    // Skip if already downloaded and correct size
    if (fs.existsSync(dest)) {
      const stat = fs.statSync(dest);
      if (asset.size > 0 && stat.size === asset.size && (!asset.sha256 || sha256(dest) === asset.sha256)) {
        completed++;
        downloadedBytes += asset.size;
        const pct = ((completed + failed) / toDownload.length * 100).toFixed(0);
        process.stdout.write(
          `\r  [${pct}%] ${completed} done, ${failed} failed`
        );
        return;
      }
    }

    try {
      const temp = dest + '.partial';
      if (sceneIds.has(asset.id) && !asset.sha256) throw new Error(`Incomplete scene entry: ${asset.id}`);
      const sourceUrl = new URL(asset.url);
      if (sourceUrl.protocol !== 'https:' || !sourceUrl.hostname.endsWith('.public.blob.vercel-storage.com')) {
        throw new Error(`Asset must come from Vercel Blob: ${asset.id}`);
      }
      await downloadFile(asset.url, temp, asset.size);
      if (asset.sha256 && sha256(temp) !== asset.sha256) throw new Error(`SHA-256 mismatch: ${asset.id}`);
      fs.renameSync(temp, dest);
      completed++;
      downloadedBytes += asset.size;
    } catch (err) {
      failed++;
      const msg = `${asset.id}: ${err instanceof Error ? err.message : err}`;
      errors.push(msg);
    }

    const pct = ((completed + failed) / toDownload.length * 100).toFixed(0);
    process.stdout.write(
      `\r  [${pct}%] ${completed} done, ${failed} failed`
    );
  });

  console.log();
  console.log();

  // 6. Summary
  console.log('════════════════════════════════════════════');
  console.log(`  Downloaded : ${completed} assets (${formatBytes(downloadedBytes)})`);
  console.log(`  Failed     : ${failed}`);
  console.log(`  Pack ver.  : ${manifest.assetPackVersion}`);
  console.log(`  Output     : ${OUTPUT_DIR}`);
  console.log('════════════════════════════════════════════');

  if (errors.length > 0) {
    console.error('\nErrors:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  fs.writeFileSync(manifestDest + '.partial', JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(manifestDest + '.partial', manifestDest);

  console.log('\nAsset pack ready for packaging.');
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
