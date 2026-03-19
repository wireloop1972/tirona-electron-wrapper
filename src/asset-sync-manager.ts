import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Asset Pack Manager for Steam/Electron builds.
 *
 * Provides helpers for the Vercel Blob interceptor: reads the bundled
 * manifest, resolves local file paths, and maps Blob URLs to disk.
 *
 * The web app's own asset-sync.ts (on Vercel) handles IndexedDB writes;
 * this module only serves files from the local asset-pack directory so
 * the web sync reads them from disk instead of the network.
 */

export interface AssetEntry {
  id: string;
  url: string;
  hash: string;
  size: number;
  category: 'glb' | 'hdri' | 'texture' | 'other';
}

export interface AssetManifest {
  assetPackVersion: string;
  generatedAt: string;
  required: string[];
  assets: AssetEntry[];
  backgroundImageUrl?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
  '.exr': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

export const getAssetPackPath = (): string => {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'asset-pack')
    : path.join(__dirname, '..', 'asset-pack');
};

export const getStaticPackPath = (): string => {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'static-pack')
    : path.join(__dirname, '..', 'static-pack');
};

const STATIC_PATH_PREFIXES = ['/textures/', '/hdr/'];

export const isStaticAssetPath = (urlPath: string): boolean => {
  return STATIC_PATH_PREFIXES.some((p) => urlPath.startsWith(p));
};

export const resolveStaticAsset = (
  staticPackDir: string,
  urlPath: string
): string | null => {
  const localPath = path.join(staticPackDir, urlPath);
  return fs.existsSync(localPath) ? localPath : null;
};

export const loadBundledManifest = (
  assetPackDir?: string
): AssetManifest | null => {
  const dir = assetPackDir ?? getAssetPackPath();
  const manifestPath = path.join(dir, 'manifest.json');
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as AssetManifest;
  } catch (err) {
    console.error('[AssetPack] Failed to read manifest:', err);
    return null;
  }
};

/**
 * Extract the pathname portion from a Vercel Blob storage URL.
 * Example input:  https://abc123.blob.vercel-storage.com/assets/monsters/goblin.glb?token=...
 * Example output: assets/monsters/goblin.glb
 */
export const extractBlobPathname = (blobUrl: string): string | null => {
  const match = blobUrl.match(
    /https?:\/\/[^/]+\.blob\.vercel-storage\.com\/([^?]+)/
  );
  return match ? decodeURIComponent(match[1]) : null;
};

export const getMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
};

/**
 * Build a lookup map from Vercel Blob pathname -> local file path.
 * Used by the HTTPS interceptor to resolve which requests can be
 * served from the bundled asset pack.
 */
export const buildBlobLookup = (
  manifest: AssetManifest,
  assetPackDir: string
): Map<string, string> => {
  const lookup = new Map<string, string>();
  for (const asset of manifest.assets) {
    const blobPathname = extractBlobPathname(asset.url);
    if (blobPathname) {
      lookup.set(blobPathname, path.join(assetPackDir, asset.id));
    }
  }
  return lookup;
};

/**
 * Quick validation: check that the manifest exists and a sample of
 * files are present on disk.  Returns a summary for logging.
 */
export const validateAssetPack = (
  assetPackDir?: string
): { valid: boolean; totalAssets: number; missingCount: number } => {
  const dir = assetPackDir ?? getAssetPackPath();
  const manifest = loadBundledManifest(dir);
  if (!manifest) return { valid: false, totalAssets: 0, missingCount: 0 };

  let missing = 0;
  for (const asset of manifest.assets) {
    const filePath = path.join(dir, asset.id);
    if (!fs.existsSync(filePath)) missing++;
  }

  return {
    valid: missing === 0,
    totalAssets: manifest.assets.length,
    missingCount: missing,
  };
};
