/** WAV (RIFF PCM) encode/decode: 16/24-bit integer and 32-bit float. No metadata → byte-stable output. */
import { type Audio, isStereo } from './signal.ts';

export type WavFormat = 'pcm16' | 'pcm24' | 'float32';

export function encodeWav(a: Audio, sr: number, format: WavFormat = 'pcm24'): Uint8Array {
  const chans = isStereo(a) ? a : [a];
  const nch = chans.length;
  const n = chans[0]!.length;
  const bps = format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4;
  const dataLen = n * nch * bps;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, format === 'float32' ? 3 : 1, true);
  dv.setUint16(22, nch, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * nch * bps, true);
  dv.setUint16(32, nch * bps, true);
  dv.setUint16(34, bps * 8, true);
  str(36, 'data');
  dv.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c]![i] as number));
      if (format === 'float32') dv.setFloat32(o, v, true);
      else if (format === 'pcm16') dv.setInt16(o, Math.round(v < 0 ? v * 32768 : v * 32767), true);
      else {
        const s = Math.round(v < 0 ? v * 8388608 : v * 8388607);
        dv.setUint8(o, s & 0xff);
        dv.setUint8(o + 1, (s >> 8) & 0xff);
        dv.setUint8(o + 2, (s >> 16) & 0xff);
      }
      o += bps;
    }
  }
  return new Uint8Array(buf);
}

export interface DecodedWav {
  sampleRate: number;
  audio: Audio;
}

/** Decode PCM 16/24/32-bit integer or 32-bit float WAV (chunks other than fmt/data are skipped). */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number): string => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('decodeWav: keine RIFF/WAVE-Datei');
  let o = 12;
  let fmt: { format: number; nch: number; sr: number; bits: number } | undefined;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const len = dv.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ') {
      let format = dv.getUint16(body, true);
      if (format === 0xfffe) format = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE subformat
      fmt = { format, nch: dv.getUint16(body + 2, true), sr: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('decodeWav: data vor fmt');
      const bps = fmt.bits / 8;
      const n = Math.floor(Math.min(len, bytes.length - body) / (bps * fmt.nch));
      const chans = Array.from({ length: fmt.nch }, () => new Float32Array(n));
      let p = body;
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < fmt.nch; c++) {
          let v: number;
          if (fmt.format === 3) v = fmt.bits === 64 ? dv.getFloat64(p, true) : dv.getFloat32(p, true);
          else if (fmt.bits === 16) v = dv.getInt16(p, true) / 32768;
          else if (fmt.bits === 24) {
            let s = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getUint8(p + 2) << 16);
            if (s & 0x800000) s -= 0x1000000;
            v = s / 8388608;
          } else if (fmt.bits === 32) v = dv.getInt32(p, true) / 2147483648;
          else if (fmt.bits === 8) v = (dv.getUint8(p) - 128) / 128;
          else throw new Error(`decodeWav: ${fmt.bits} Bit nicht unterstützt`);
          chans[c]![i] = v;
          p += bps;
        }
      }
      const audio: Audio = chans.length >= 2 ? [chans[0]!, chans[1]!] : chans[0]!;
      return { sampleRate: fmt.sr, audio };
    }
    o = body + len + (len & 1);
  }
  throw new Error('decodeWav: kein data-Chunk');
}
