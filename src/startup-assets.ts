import { protocol } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { buildSceneLookup, getAssetPackPath, loadBundledManifest, getMimeType } from './asset-sync-manager';

protocol.registerSchemesAsPrivileged([{scheme:'tirona-local',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
export function registerStartupAssets(): void {
  const dir = getAssetPackPath();
  const manifest = loadBundledManifest(dir);
  const lookup = manifest ? buildSceneLookup(manifest, dir) : new Map<string,string>();
  lookup.set('/launcher/map.jpg',path.join(__dirname,'startup-assets/map.jpg'));
  lookup.set('/launcher/cover.png',path.join(__dirname,'startup-assets/cover.png'));
  protocol.handle('tirona-local', request => {
    const file = lookup.get(decodeURIComponent(new URL(request.url).pathname));
    if (!file || !fs.existsSync(file)) return new Response('Packaged asset missing',{status:404});
    return new Response(fs.readFileSync(file),{headers:{'Content-Type':getMimeType(file)}});
  });
}
