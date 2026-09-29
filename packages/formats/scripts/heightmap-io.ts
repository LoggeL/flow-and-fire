/**
 * Heightmap inputs of the CLI import (Node only). The result is always dim² u16 height steps,
 * row-major from the map's z = 0 edge (index z·dim + x), with dim = 2^n + 1.
 *
 *  .png  grayscale, 16 bit: samples are used as-is; 8 bit: expanded with v·257 (0..255 → 0..65535)
 *  .pgm  binary P5; maxval ≥ 256 ⇒ 2 bytes per sample big-endian (used as-is, must be ≤ maxval);
 *        maxval = 255 ⇒ 1 byte per sample, expanded with v·257 like 8-bit PNG
 *  .r16  raw u16 little-endian, no header; the edge length comes from the file size
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { decodePng, encodePng } from './png.ts';

export interface HeightmapData {
  /** Samples per edge (2^n + 1). */
  readonly dim: number;
  /** dim² u16 height steps, index z·dim + x. */
  readonly samples: Uint16Array;
}

export class HeightmapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeightmapError';
  }
}

function checkDim(dim: number, source: string): void {
  const n = dim - 1;
  if (n < 1 || (n & (n - 1)) !== 0) throw new HeightmapError(`${source}: edge length ${dim} is not 2^n + 1 (e.g. 513)`);
}

export function decodeHeightmapPng(bytes: Uint8Array, source = 'png'): HeightmapData {
  const img = decodePng(bytes);
  if (img.channels !== 1) throw new HeightmapError(`${source}: heightmap PNG must be grayscale without alpha (got ${img.channels} channels)`);
  if (img.width !== img.height) throw new HeightmapError(`${source}: heightmap must be square (got ${img.width}×${img.height})`);
  checkDim(img.width, source);
  const samples = img.bitDepth === 16 ? img.samples : img.samples.map((v) => v * 257);
  return { dim: img.width, samples };
}

export function decodePgm(bytes: Uint8Array, source = 'pgm'): HeightmapData {
  // Header: "P5" whitespace width whitespace height whitespace maxval, then exactly one whitespace.
  let p = 0;
  const tokens: string[] = [];
  const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c;
  while (tokens.length < 4) {
    if (p >= bytes.length) throw new HeightmapError(`${source}: truncated PGM header`);
    const c = bytes[p]!;
    if (c === 0x23) {
      while (p < bytes.length && bytes[p] !== 0x0a && bytes[p] !== 0x0d) p++;
    } else if (isSpace(c)) {
      p++;
    } else {
      let t = '';
      while (p < bytes.length && !isSpace(bytes[p]!) && bytes[p] !== 0x23) t += String.fromCharCode(bytes[p++]!);
      tokens.push(t);
    }
  }
  if (p >= bytes.length || !isSpace(bytes[p]!)) throw new HeightmapError(`${source}: PGM header must end with one whitespace byte`);
  p++;
  const [magic, ws, hs, ms] = tokens as [string, string, string, string];
  if (magic !== 'P5') throw new HeightmapError(`${source}: only binary PGM (P5) is supported, got '${magic}'`);
  const w = Number.parseInt(ws, 10);
  const h = Number.parseInt(hs, 10);
  const maxval = Number.parseInt(ms, 10);
  if (!(w > 0) || !(h > 0) || String(w) !== ws || String(h) !== hs) throw new HeightmapError(`${source}: invalid PGM size '${ws} ${hs}'`);
  if (w !== h) throw new HeightmapError(`${source}: heightmap must be square (got ${w}×${h})`);
  checkDim(w, source);
  if (!(maxval > 0 && maxval <= 65535) || String(maxval) !== ms) throw new HeightmapError(`${source}: invalid PGM maxval '${ms}'`);
  if (maxval < 256 && maxval !== 255) throw new HeightmapError(`${source}: 8-bit PGM must use maxval 255 (got ${maxval})`);
  const wide = maxval >= 256;
  const need = w * h * (wide ? 2 : 1);
  if (bytes.length - p !== need) throw new HeightmapError(`${source}: PGM has ${bytes.length - p} data bytes, expected ${need}`);
  const samples = new Uint16Array(w * h);
  for (let i = 0; i < samples.length; i++) {
    const v = wide ? (bytes[p + 2 * i]! << 8) | bytes[p + 2 * i + 1]! : bytes[p + i]! * 257;
    if (wide && v > maxval) throw new HeightmapError(`${source}: sample ${i} (${v}) exceeds maxval ${maxval}`);
    samples[i] = v;
  }
  return { dim: w, samples };
}

export function decodeR16(bytes: Uint8Array, source = 'r16'): HeightmapData {
  if (bytes.length % 2 !== 0) throw new HeightmapError(`${source}: .r16 size ${bytes.length} is odd`);
  const n = bytes.length / 2;
  const dim = Math.round(Math.sqrt(n));
  if (dim * dim !== n) throw new HeightmapError(`${source}: .r16 holds ${n} samples, not a square`);
  checkDim(dim, source);
  const samples = new Uint16Array(n);
  for (let i = 0; i < n; i++) samples[i] = bytes[2 * i]! | (bytes[2 * i + 1]! << 8);
  return { dim, samples };
}

/** Reads a heightmap file (.png, .pgm or .r16, chosen by extension). */
export function readHeightmap(path: string): HeightmapData {
  const bytes = new Uint8Array(readFileSync(path));
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return decodeHeightmapPng(bytes, path);
  if (ext === '.pgm') return decodePgm(bytes, path);
  if (ext === '.r16') return decodeR16(bytes, path);
  throw new HeightmapError(`${path}: unsupported heightmap format '${ext}' (use .png, .pgm or .r16)`);
}

export function encodeHeightmapPng(hm: HeightmapData): Uint8Array {
  return encodePng({ width: hm.dim, height: hm.dim, bitDepth: 16, channels: 1, samples: hm.samples });
}

export function encodePgm(hm: HeightmapData): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${hm.dim} ${hm.dim}\n65535\n`);
  const out = new Uint8Array(header.length + hm.samples.length * 2);
  out.set(header);
  for (let i = 0, p = header.length; i < hm.samples.length; i++, p += 2) {
    out[p] = hm.samples[i]! >>> 8;
    out[p + 1] = hm.samples[i]! & 0xff;
  }
  return out;
}

export function encodeR16(hm: HeightmapData): Uint8Array {
  const out = new Uint8Array(hm.samples.length * 2);
  for (let i = 0; i < hm.samples.length; i++) {
    out[2 * i] = hm.samples[i]! & 0xff;
    out[2 * i + 1] = hm.samples[i]! >>> 8;
  }
  return out;
}

export function writeHeightmapPng(path: string, hm: HeightmapData): void {
  writeFileSync(path, encodeHeightmapPng(hm));
}
