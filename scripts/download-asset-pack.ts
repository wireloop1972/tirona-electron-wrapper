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

// ── Types ────────────────────────────────────────────────────────────────────

interface AssetEntry {
  id: string;
  url: string;
  hash: string;
  size: number;
  category: 'glb' | 'hdri' | 'texture' | 'other';
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
  const toDownload = manifest.assets.filter((a) => requiredSet.has(a.id));
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
  fs.writeFileSync(manifestDest, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`  Saved manifest.json`);

  // 5. Download assets with concurrency pool
  let completed = 0;
  let failed = 0;
  let downloadedBytes = 0;
  const errors: string[] = [];

  await runPool(toDownload, CONCURRENCY, async (asset, _i) => {
    const dest = path.join(OUTPUT_DIR, asset.id);

    // Skip if already downloaded and correct size
    if (fs.existsSync(dest)) {
      const stat = fs.statSync(dest);
      if (asset.size > 0 && stat.size === asset.size) {
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
      await downloadFile(asset.url, dest, asset.size);
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

  console.log('\nAsset pack ready for packaging.');
};

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
