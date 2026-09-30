/**
 * Perceptual volume curve and dB helpers of the mixer.
 *
 * Curve choice: `gain = v²` (not dB-linear over 50 dB).
 * - Stevens' power law puts perceived loudness at roughly (sound pressure)^0.6, so a slider that
 *   should feel linear in loudness needs gain ≈ v^(1/0.6) = v^1.67; v² is the closest simple
 *   power and slightly favours fine control at the quiet end.
 * - 0 maps to exact silence and 1 to unity without a special case or a jump at the bottom end
 *   (a pure dB-linear mapping never reaches 0 and needs a cut-off step at v = 0).
 * - Reference points: v 0.75 → −5 dB, 0.5 → −12 dB, 0.25 → −24 dB, 0.1 → −40 dB, 0.05 → −52 dB.
 *   A 50 dB dB-linear law would already put the slider midpoint at −25 dB, which together with
 *   the −20…−30 LUFS file targets and distance attenuation makes the lower half of the slider
 *   practically unusable in a game mix.
 */

/** Linear gain of a dB value. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** dB value of a linear gain (−Infinity for 0). */
export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain);
}

/** Clamps to [0, 1]; non-finite input becomes 0. */
export function clamp01(v: number): number {
  if (!(v > 0)) return 0; // also catches NaN
  return v >= 1 ? 1 : v;
}

/** Slider position 0..1 → linear gain 0..1 (v², monotonic, 0 → 0, 1 → 1). */
export function sliderToGain(v: number): number {
  const c = clamp01(v);
  return c * c;
}

/** Inverse of {@link sliderToGain} (gain 0..1 → slider 0..1). */
export function gainToSlider(g: number): number {
  return Math.sqrt(clamp01(g));
}
