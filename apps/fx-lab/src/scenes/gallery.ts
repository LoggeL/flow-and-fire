import { VARKAN_EFFECTS } from '@faf/render-fx';
import type { LabContext, LabScene } from '../app/context.ts';
import { groundPos, sceneFx } from './fx.ts';
class GalleryScene implements LabScene {
  readonly name = 'gallery' as const;
  readonly camera = { targetWu: [256, 270] as const, distanceWu: 300, pitchDeg: 65, headingDeg: -90 };
  private readonly captions: { text: string; xWu: number; yWu: number; zWu: number }[] = [];
  private next = 0.25;
  private bursts = 0;
  init(ctx: LabContext): void {
    VARKAN_EFFECTS.forEach((effect, i) => {
      const x = 156 + i % 5 * 50 + ctx.rng.range(-0.5, 0.5), z = 176 + Math.floor(i / 5) * 45 + ctx.rng.range(-0.5, 0.5);
      this.captions.push({ text: effect.id.replace('varkan:', ''), xWu: x, yWu: ctx.groundHeight(x, z) + 7, zWu: z });
      if (effect.continuous) sceneFx(ctx).emitter(effect.id, groundPos(ctx, x, z, 2), groundPos(ctx, x + 10, z, 2));
    });
  }
  update(ctx: LabContext, t: number): void {
    if (t < this.next) return;
    VARKAN_EFFECTS.forEach((e, i) => { if (!e.continuous) { const p = this.captions[i]!; sceneFx(ctx).burst(e.id, groundPos(ctx, p.xWu, p.zWu, 1), t, e.id.includes('acu') ? 0.4 : 1); this.bursts++; } });
    this.next += 2.5;
  }
  labels(): readonly { text: string; xWu: number; yWu: number; zWu: number }[] { return this.captions; }
  stats(): Readonly<Record<string, number>> { return { registered: VARKAN_EFFECTS.length, labels: this.captions.length, bursts: this.bursts }; }
  dispose(): void { this.captions.length = 0; }
}
export function createGalleryScene(): LabScene { return new GalleryScene(); }
