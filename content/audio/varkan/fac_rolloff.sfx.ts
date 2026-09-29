// Fabrik-Roll-off (G10): das Werk entlässt eine fertige Einheit. Ablauf:
//   0,00  Riegel schlägt zurück (tiefer Guss-Klong)
//   0,03  Tor-Hydraulik: Zischen + Pumpenmotor zieht an (Säge 70 → 120 Hz), Tor läuft
//   ~0,75 Tor schlägt in den Anschlag (Klong), Hydraulik bläst ab
//   0,6+  Rumpeln über die Schwelle, Kettenglieder klirren schneller, Antrieb fährt an und entfernt sich
import { PLATE_PARTIALS, bandpass, clang, defineSfx, envelope, highpass, lowpass, mixMono, mul, noise, osc, samples, thump, tick } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:fac_rolloff',
  category: 'build',
  description: 'Fabrik-Roll-off: Riegel, Tor-Hydraulik, Anschlag, Rumpeln und Anfahren',
  variants: 3,
  tags: ['varkan', 'fabrik', 'MS6'],
  render({ rng, sr }) {
    const dur = 1.95;
    const p = rng.jitter(0.04);
    const gateEnd = 0.72 + rng.range(0, 0.08);
    const latch = clang({ f0: 165 * p, rng: rng.fork('latch'), durS: 0.5, decayScale: 0.5, partials: PLATE_PARTIALS, strike: 0.5 });
    const stop = clang({ f0: 128 * p, rng: rng.fork('stop'), durS: 0.6, decayScale: 0.6, partials: PLATE_PARTIALS, strike: 0.4 });
    const hydEnv = envelope([[0, 0], [0.06, 0.9, 'lin'], [gateEnd - 0.05, 1, 'lin'], [gateEnd + 0.02, 0.2, 'lin'], [gateEnd + 0.35, 0, 'exp']], gateEnd + 0.4, sr);
    const hydraulic = mul(bandpass(noise('pink', gateEnd + 0.4, rng.fork('hyd')), envelope([[0, 1600], [gateEnd, 2400, 'lin'], [gateEnd + 0.4, 3400, 'lin']], gateEnd + 0.4, sr), 1.4), hydEnv);
    const motorLen = gateEnd + 0.1;
    const motor = mul(lowpass(osc('saw', envelope([[0, 70 * p], [0.25, 120 * p, 0.6], [motorLen, 128 * p, 'lin']], motorLen, sr), motorLen), 600, 0.8, 2), envelope([[0, 0], [0.08, 1, 'lin'], [motorLen - 0.1, 1], [motorLen, 0, 'lin']], motorLen, sr));
    // Anfahren: Antrieb (Säge 42 → 62 Hz) + Kettenglieder, die schneller werden, Rumpeln über die Schwelle.
    const driveStart = gateEnd - 0.12;
    const dLen = dur - driveStart;
    const drive = mul(lowpass(osc('saw', envelope([[0, 42 * p], [dLen, 64 * p, 0.7]], dLen, sr), dLen), 260, 0.9, 2), envelope([[0, 0], [0.25, 1, 'lin'], [dLen * 0.55, 0.9], [dLen, 0, 1.4]], dLen, sr));
    const rumble = mul(lowpass(noise('brown', dLen, rng.fork('rumble')), 240, 0.7, 2), envelope([[0, 0], [0.15, 1, 'lin'], [0.5, 0.8], [dLen, 0, 1.6]], dLen, sr));
    const links = new Float32Array(samples(dLen, sr));
    const r = rng.fork('links');
    for (let t = 0.12, k = 0; t < dLen - 0.05; k++) {
      const s = tick(r.range(800, 1300), r, r.range(0.025, 0.045));
      const g = r.range(0.4, 1) * Math.max(0, 1 - t / dLen) * Math.min(1, t / 0.2);
      const off = samples(t, sr);
      for (let i = 0; i < s.length && off + i < links.length; i++) links[off + i] = (links[off + i] as number) + (s[i] as number) * g;
      t += Math.max(0.07, 0.16 - k * 0.012) * r.jitter(0.2);
    }
    const sill = thump({ rng: rng.fork('sill'), durS: 0.35, t60: 0.22, lpFrom: 700, lpTo: 110 });
    const m = mixMono(
      [
        { sig: latch, db: -3 },
        { sig: hydraulic, db: -10, at: 0.03 },
        { sig: motor, db: -13, at: 0.03 },
        { sig: stop, db: 0, at: gateEnd },
        { sig: drive, db: -9, at: driveStart },
        { sig: rumble, db: -8, at: driveStart },
        { sig: links, db: -9, at: driveStart },
        { sig: sill, db: -6, at: driveStart + 0.35 + rng.range(0, 0.1) },
      ],
      dur,
    );
    return highpass(m, 45, 0.7, 2);
  },
});
