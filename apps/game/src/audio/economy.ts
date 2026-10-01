import { FX_ONE, type FafAudioEngine } from '@faf/audio';
import type { FrameReader } from '@faf/protocol';

/** Own economy and build-progress fallbacks when the frame lacks an equivalent fresh event. */
export class EconomyAudio {
  private previous = new Map<number, number>();
  private next = new Map<number, number>();
  private stallFlags = 0;
  constructor(private readonly army: number) {}

  reset(): void { this.previous.clear(); this.next.clear(); this.stallFlags = 0; }

  update(frame: FrameReader, engine: FafAudioEngine, kinds: Readonly<Record<number, string>>, audibleStall: boolean, afterEventTick = frame.tick - 1): void {
    let massEvent = false;
    let energyEvent = false;
    for (let i = 0; i < frame.eventCount; i++) {
      // Only the fresh own event routed by the bridge suppresses this own eco transition.
      // An allied stall or a retained historical event cannot suppress the fallback.
      if (this.army < 0 || frame.eventVisual(i) !== this.army || frame.eventTick(i) <= afterEventTick) continue;
      const kind = kinds[frame.eventType(i)];
      if (kind === 'massStall') massEvent = true;
      if (kind === 'energyStall') energyEvent = true;
    }
    for (let i = 0; i < frame.ecoCount; i++) {
      if (frame.ecoArmy(i) !== this.army) continue;
      const flags = frame.ecoStallFlags(i);
      const started = flags & ~this.stallFlags;
      if (audibleStall && !frame.paused) {
        if ((started & 1) !== 0 && !massEvent) engine.alert({ kind: 'alt_mass_stall' });
        if ((started & 2) !== 0 && !energyEvent) {
          engine.playUi('eco_flow_stall');
          engine.alert({ kind: 'alt_energy_stall' });
        }
      }
      this.stallFlags = flags;
    }

    this.next.clear();
    let progress = 0;
    let x = 0;
    let z = 0;
    let sites = 0;
    for (let i = 0; i < frame.unitCount; i++) {
      if (frame.unitArmy(i) !== this.army) continue;
      const handle = frame.unitHandle(i);
      const build = frame.unitBuild(i);
      const previous = this.previous.get(handle);
      if (build < 255) this.next.set(handle, build);
      if (previous === undefined || frame.paused) continue;
      if (build === 255) {
        let emitted = false;
        for (let e = 0; e < frame.eventCount; e++) {
          if (kinds[frame.eventType(e)] === 'buildComplete' && frame.eventHandle(e) === handle) { emitted = true; break; }
        }
        if (!emitted) {
          const x = frame.unitCur(i, 0) / FX_ONE;
          const z = frame.unitCur(i, 2) / FX_ONE;
          engine.play({ sound: 'bld_complete', x, z });
          engine.play({ sound: 'sig_bell_small', when: engine.context.currentTime + 0.35 });
        }
      } else if (build > previous) {
        progress += build - previous;
        x += frame.unitCur(i, 0) / FX_ONE;
        z += frame.unitCur(i, 2) / FX_ONE;
        sites++;
      }
    }
    engine.setLoop(`build:${this.army}`, sites > 0 ? {
      sound: 'bld_pour_loop', x: x / sites, z: z / sites,
      rate: Math.min(1.2, 0.8 + progress / (sites * 255)),
    } : null);
    const old = this.previous;
    this.previous = this.next;
    this.next = old;
  }
}
