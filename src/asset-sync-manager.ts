import { BrowserWindow } from 'electron';

/**
 * Asset Sync Manager for Electron
 * 
 * Handles checking for asset updates and coordinating downloads
 * before the main application loads.
 */

// Asset manifest types (matching the Next.js API)
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
}

// Sync progress data
export interface SyncProgress {
  downloadedBytes: number;
  totalBytes: number;
  currentAsset?: string;
  currentAssetBytes?: number;
  currentAssetTotal?: number;
  completed: number;
  remaining: number;
  failed: number;
}

// Sync result
interface SyncResult {
  success: boolean;
  downloaded: number;
  failed: number;
  skipped: boolean;
}

/**
 * Fetch the asset manifest from the server
 */
export const fetchManifest = async (apiBaseUrl: string): Promise<AssetManifest | null> => {
  try {
    console.log('[AssetSync] Fetching manifest from:', apiBaseUrl + '/api/assets/manifest');
    const response = await fetch(apiBaseUrl + '/api/assets/manifest', {
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      console.error('[AssetSync] Failed to fetch manifest:', response.status);
      return null;
    }
    
    return await response.json() as AssetManifest;
  } catch (error) {
    console.error('[AssetSync] Error fetching manifest:', error);
    return null;
  }
};

/**
 * Get cached asset version from the loading window's localStorage
 */
export const getCachedVersion = async (loadingWindow: BrowserWindow): Promise<string | null> => {
  try {
    const result = await loadingWindow.webContents.executeJavaScript(
      "localStorage.getItem('assetPackVersion')"
    );
    return result;
  } catch (error) {
    console.error('[AssetSync] Error getting cached version:', error);
    return null;
  }
};

/**
 * Set cached asset version in localStorage
 */
export const setCachedVersion = async (
  loadingWindow: BrowserWindow, 
  version: string
): Promise<void> => {
  try {
    await loadingWindow.webContents.executeJavaScript(
      `localStorage.setItem('assetPackVersion', '${version}')`
    );
  } catch (error) {
    console.error('[AssetSync] Error setting cached version:', error);
  }
};

/**
 * Check if sync is needed by comparing versions
 */
export const checkSyncNeeded = async (
  loadingWindow: BrowserWindow,
  apiBaseUrl: string
): Promise<{ needed: boolean; manifest?: AssetManifest; reason?: string }> => {
  // Fetch manifest
  const manifest = await fetchManifest(apiBaseUrl);
  
  if (!manifest) {
    return { needed: false, reason: 'Could not fetch manifest (offline?)' };
  }
  
  // Get cached version
  const cachedVersion = await getCachedVersion(loadingWindow);
  
  console.log('[AssetSync] Server version:', manifest.assetPackVersion);
  console.log('[AssetSync] Cached version:', cachedVersion);
  
  if (!cachedVersion) {
    return { needed: true, manifest, reason: 'No cached assets' };
  }
  
  if (cachedVersion !== manifest.assetPackVersion) {
    return { needed: true, manifest, reason: 'Version mismatch' };
  }
  
  return { needed: false, manifest, reason: 'Assets up to date' };
};

/**
 * Download assets and store in IndexedDB via the loading window
 */
export const downloadAssets = async (
  loadingWindow: BrowserWindow,
  manifest: AssetManifest,
  onProgress: (progress: SyncProgress) => void
): Promise<SyncResult> => {
  const requiredAssets = manifest.assets.filter(a => manifest.required.includes(a.id));
  const totalBytes = requiredAssets.reduce((sum, a) => sum + a.size, 0);
  
  let downloadedBytes = 0;
  let completed = 0;
  let failed = 0;
  
  console.log('[AssetSync] Downloading', requiredAssets.length, 'assets, total:', totalBytes, 'bytes');
  
  for (const asset of requiredAssets) {
    const remaining = requiredAssets.length - completed - failed;
    
    // Update progress - starting new asset
    onProgress({
      downloadedBytes,
      totalBytes,
      currentAsset: asset.id,
      currentAssetBytes: 0,
      currentAssetTotal: asset.size,
      completed,
      remaining,
      failed
    });
    
    try {
      // Download and store asset via the renderer's IndexedDB
      const jsCode = `
        (async () => {
          try {
            const response = await fetch('${asset.url}');
            if (!response.ok) throw new Error('HTTP ' + response.status);
            
            const blob = await response.blob();
            
            // Open IndexedDB
            const db = await new Promise((resolve, reject) => {
              const request = indexedDB.open('gameAssets', 1);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve(request.result);
              request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('assets')) {
                  db.createObjectStore('assets', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('meta')) {
                  db.createObjectStore('meta', { keyPath: 'key' });
                }
              };
            });
            
            // Store asset
            await new Promise((resolve, reject) => {
              const tx = db.transaction('assets', 'readwrite');
              const store = tx.objectStore('assets');
              store.put({
                id: '${asset.id}',
                hash: '${asset.hash}',
                size: ${asset.size},
                category: '${asset.category}',
                data: blob,
                updatedAt: new Date()
              });
              tx.oncomplete = () => resolve(true);
              tx.onerror = () => reject(tx.error);
            });
            
            db.close();
            return true;
          } catch (e) {
            console.error('Failed to download asset:', e);
            return false;
          }
        })()
      `;
      
      const success = await loadingWindow.webContents.executeJavaScript(jsCode);
      
      if (success) {
        downloadedBytes += asset.size;
        completed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error('[AssetSync] Error downloading', asset.id, ':', error);
      failed++;
    }
    
    // Update progress after each asset
    onProgress({
      downloadedBytes,
      totalBytes,
      currentAsset: asset.id,
      currentAssetBytes: asset.size,
      currentAssetTotal: asset.size,
      completed,
      remaining: requiredAssets.length - completed - failed,
      failed
    });
  }
  
  // Save the new version if successful
  if (failed === 0) {
    await setCachedVersion(loadingWindow, manifest.assetPackVersion);
  }
  
  return {
    success: failed === 0,
    downloaded: completed,
    failed,
    skipped: false
  };
};

/**
 * Main sync function - checks and downloads if needed
 */
export const performAssetSync = async (
  loadingWindow: BrowserWindow,
  apiBaseUrl: string,
  onStatus: (status: string, message?: string) => void,
  onProgress: (progress: SyncProgress) => void
): Promise<SyncResult> => {
  // Check if sync is needed
  onStatus('checking', 'Checking for updates...');
  
  const checkResult = await checkSyncNeeded(loadingWindow, apiBaseUrl);
  
  if (!checkResult.needed) {
    console.log('[AssetSync] No sync needed:', checkResult.reason);
    onStatus('skip', checkResult.reason);
    return { success: true, downloaded: 0, failed: 0, skipped: true };
  }
  
  console.log('[AssetSync] Sync needed:', checkResult.reason);
  onStatus('syncing', 'Downloading assets...');
  
  // Download required assets
  const result = await downloadAssets(
    loadingWindow,
    checkResult.manifest!,
    onProgress
  );
  
  if (result.success) {
    onStatus('complete', 'Sync complete!');
  } else {
    onStatus('error', 'Some assets failed to download');
  }
  
  return result;
};
