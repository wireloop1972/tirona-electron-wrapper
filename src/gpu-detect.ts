import { execSync } from 'child_process';

export interface GpuInfo {
  available: boolean;
  gpuName?: string;
  vramMB?: number;
}

/** AMD detection result. `available` means a ROCm-on-Windows-capable model
 *  was found, not merely "some AMD GPU exists". */
export interface AmdGpuInfo extends GpuInfo {
  /** Every video controller name seen, for remote-debugging logs. */
  allNames?: string[];
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

// =============================================================================
// AMD – ROCm-on-Windows support gate
// =============================================================================

/**
 * GPUs with official PyTorch-on-ROCm Windows wheel support (ROCm 7.2.x,
 * public preview): RDNA3/RDNA4 desktop cards plus Strix Halo APU graphics.
 * RDNA2 (RX 6000) and older are NOT supported by AMD's Windows wheels and
 * must not pass this gate — they would fail at model load.
 *
 * Word-boundary anchors keep mobile variants (e.g. "RX 7900M") from
 * matching the desktop patterns.
 */
const AMD_ROCM_WIN_SUPPORTED: RegExp[] = [
  /\bRX\s*7700\s*XT\b/i,
  /\bRX\s*7800\s*XT\b/i,
  /\bRX\s*7900\s*(GRE|XTX|XT)\b/i,
  /\bRX\s*9060(\s*XT)?\b/i,
  /\bRX\s*9070(\s*XT)?\b/i,
  /\bRadeon\s*(\(TM\)\s*)?8050S\b/i,
  /\bRadeon\s*(\(TM\)\s*)?8060S\b/i,
  /\bPRO\s*W7800\b/i,
  /\bPRO\s*W7900\b/i,
  /\bAI\s*PRO\s*R9700\b/i,
];

/** Pure matcher (exported for testing): first supported name, or null. */
export const matchSupportedAmdGpu = (names: string[]): string | null => {
  for (const name of names) {
    if (AMD_ROCM_WIN_SUPPORTED.some(re => re.test(name))) return name;
  }
  return null;
};

let cachedAmdResult: AmdGpuInfo | null = null;

export const detectAmdGpu = (): AmdGpuInfo => {
  if (cachedAmdResult !== null) return cachedAmdResult;

  try {
    const out = execSync(
      'powershell.exe -NoProfile -NonInteractive -Command ' +
      '"(Get-CimInstance Win32_VideoController | ' +
      'Select-Object -ExpandProperty Name) -join \'|\'"',
      { encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();

    const allNames = out.split('|').map(s => s.trim()).filter(Boolean);
    const match = matchSupportedAmdGpu(allNames);

    cachedAmdResult = match
      ? { available: true, gpuName: match, allNames }
      : { available: false, allNames };

    console.log(
      match
        ? `[GPU Detect] ROCm-capable AMD GPU found: ${match}`
        : `[GPU Detect] No ROCm-on-Windows-capable AMD GPU ` +
          `(saw: ${allNames.join(', ') || 'none'})`
    );
    return cachedAmdResult;
  } catch {
    cachedAmdResult = { available: false };
    console.log('[GPU Detect] AMD GPU query failed');
    return cachedAmdResult;
  }
};
