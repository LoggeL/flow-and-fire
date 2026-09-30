/**
 * Small canvas textures of the overlay (army numbers, issue badges). Without a canvas (Node
 * tests) the functions return null and the sprites fall back to a plain colour.
 */
import * as THREE from 'three';

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): Canvas2D | null {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

function context(c: Canvas2D): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  try {
    return c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  } catch {
    return null;
  }
}

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function texture(c: Canvas2D): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c as HTMLCanvasElement);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 1;
  t.needsUpdate = true;
  return t;
}

const SIZE = 128;

/**
 * Round badge with a text (army number): coloured disc, dark rim, white text with outline.
 * Returns null without a canvas.
 */
export function badgeTexture(text: string, fillHex: number): THREE.CanvasTexture | null {
  const c = makeCanvas(SIZE, SIZE);
  if (c === null) return null;
  const g = context(c);
  if (g === null) return null;
  const r = SIZE / 2;
  g.clearRect(0, 0, SIZE, SIZE);
  g.beginPath();
  g.arc(r, r, r - 6, 0, Math.PI * 2);
  g.fillStyle = css(fillHex);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(8, 11, 16, 0.92)';
  g.stroke();
  g.font = `bold ${text.length > 1 ? 58 : 72}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 9;
  g.strokeStyle = 'rgba(8, 11, 16, 0.9)';
  g.strokeText(text, r, r + 4);
  g.fillStyle = '#ffffff';
  g.fillText(text, r, r + 4);
  return texture(c);
}

/** Issue badge: triangle (error/warning) or circle (info) with an exclamation mark / "i". */
export function issueTexture(severity: 'error' | 'warning' | 'info', fillHex: number): THREE.CanvasTexture | null {
  const c = makeCanvas(SIZE, SIZE);
  if (c === null) return null;
  const g = context(c);
  if (g === null) return null;
  g.clearRect(0, 0, SIZE, SIZE);
  g.beginPath();
  if (severity === 'info') {
    g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 8, 0, Math.PI * 2);
  } else {
    g.moveTo(SIZE / 2, 8);
    g.lineTo(SIZE - 8, SIZE - 12);
    g.lineTo(8, SIZE - 12);
    g.closePath();
  }
  g.fillStyle = css(fillHex);
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(8, 11, 16, 0.92)';
  g.stroke();
  g.font = `bold 70px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#10141a';
  g.fillText(severity === 'info' ? 'i' : '!', SIZE / 2, severity === 'info' ? SIZE / 2 + 4 : SIZE / 2 + 16);
  return texture(c);
}
