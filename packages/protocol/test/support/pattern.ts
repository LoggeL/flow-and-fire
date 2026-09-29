/** Self-describing test frames: u32 n | u32 len | bytes[i] = (n * 31 + i) & 255. */

export function patternLength(n: number, capacity: number): number {
  return 8 + ((n * 97) % (capacity - 8));
}

export function fillPatternFrame(buf: Uint8Array, n: number, len: number): void {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  dv.setUint32(0, n, true);
  dv.setUint32(4, len, true);
  for (let i = 8; i < len; i++) buf[i] = (n * 31 + i) & 255;
}

/** Returns the frame number if `frame` is an intact pattern frame, else −1. */
export function checkPatternFrame(frame: Uint8Array): number {
  if (frame.length < 8) return -1;
  const dv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const n = dv.getUint32(0, true);
  if (dv.getUint32(4, true) !== frame.length) return -1;
  for (let i = 8; i < frame.length; i++) if (frame[i] !== ((n * 31 + i) & 255)) return -1;
  return n;
}
