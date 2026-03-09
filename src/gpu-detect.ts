import { execSync } from 'child_process';

export interface GpuInfo {
  available: boolean;
  gpuName?: string;
  vramMB?: number;
}

let cachedResult: GpuInfo | null = null;

export const detectNvidiaGpu = (): GpuInfo => {
  if (cachedResult !== null) return cachedResult;

  try {
    const csv = execSync(
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    if (!csv) {
      cachedResult = { available: false };
      return cachedResult;
    }

    const firstLine = csv.split('\n')[0];
    const [name, memStr] = firstLine.split(',').map(s => s.trim());
    const vramMB = parseInt(memStr, 10) || undefined;

    cachedResult = { available: true, gpuName: name, vramMB };
    console.log(
      `[GPU Detect] NVIDIA GPU found: ${name} (${vramMB ?? '?'} MB VRAM)`
    );
    return cachedResult;
  } catch {
    cachedResult = { available: false };
    console.log('[GPU Detect] No NVIDIA GPU detected (nvidia-smi failed)');
    return cachedResult;
  }
};
