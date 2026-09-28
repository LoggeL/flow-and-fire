const canvas = document.getElementById('game-canvas');
const status = document.getElementById('status');

if (!(canvas instanceof HTMLCanvasElement) || status === null) {
  throw new Error('faf: missing #game-canvas or #status');
}

const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
document.documentElement.dataset['webgl2'] = gl === null ? 'unavailable' : 'ok';
document.documentElement.dataset['coi'] = String(globalThis.crossOriginIsolated === true);
document.documentElement.dataset['build'] = __IRONFLOW_BUILD_HASH__;

function resize(): void {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function draw(): void {
  if (gl === null) return;
  resize();
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(0.09, 0.16, 0.22, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

if (gl === null) {
  status.textContent = 'Flow & Fire – MS1-Gerüst (WebGL2 nicht verfügbar)';
} else {
  draw();
  window.addEventListener('resize', draw);
}
