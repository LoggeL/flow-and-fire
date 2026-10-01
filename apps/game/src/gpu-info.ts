/** Device description for the settings screen; never a performance claim. */
export interface GpuInfo { readonly name: string | null; readonly software: boolean; readonly cores: number | null }

/** "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" → "Apple M2"; other strings stay as reported. */
export function readableGpuName(raw: string): string | null {
  const text = raw.trim(), angle = /^ANGLE \((.*)\)$/.exec(text);
  if (angle === null) return text || null;
  const device = (angle[1]!.split(', ')[1] ?? angle[1]!).replace(/^ANGLE [^:]*:\s*/, '').replace(/\s+(Direct3D|vs_|ps_|OpenGL|\(0x).*$/, '').trim();
  return device || text;
}

/** Reads the WebGL2 renderer string from a short-lived context (null without a DOM or WebGL2). */
export function detectGpu(): GpuInfo {
  const cores = typeof navigator !== 'undefined' && Number.isInteger(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null;
  if (typeof document === 'undefined') return { name: null, software: false, cores };
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return { name: null, software: false, cores };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const name = readableGpuName(String(gl.getParameter(debug !== null ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? ''));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { name, software: name !== null && /swiftshader|llvmpipe|software|basic render/i.test(name), cores };
  } catch { return { name: null, software: false, cores }; }
}

/**
 * Preset recommendation from the device description only (no benchmark is run):
 * software rasterisers → Low, integrated or unknown GPUs and ≤ 4 cores → Medium, others → High.
 */
export function recommendPreset(info: GpuInfo): 'low' | 'medium' | 'high' {
  if (info.software) return 'low';
  if (info.name === null || (info.cores !== null && info.cores <= 4)) return 'medium';
  if (/apple m\d|apple gpu|nvidia|geforce|rtx|radeon(?!.*(vega \d|graphics))|arc a\d/i.test(info.name)) return 'high';
  return 'medium';
}
