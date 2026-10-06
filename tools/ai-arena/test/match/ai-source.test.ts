/**
 * End-to-end plumbing: an @faf/ai brain (test fixture manager, no real managers yet) behind an
 * AiCommandSource plays in the arena — perception bytes → brain → emitter envelopes → arena
 * decode/apply → world → metrics and replay.
 */
import { describe, expect, it } from 'vitest';
import { AiCommandSource, createBrain, defineManager, parseOpenings, Prio, profileFor } from '@faf/ai';
import { loadOpeningsJson, replayMatch, runMatch } from '../../src/index.ts';

describe('arena + AiCommandSource', () => {
  it('a fixture brain builds Landwerk I and queues engineers through the real command path', () => {
    const openings = parseOpenings(loadOpeningsJson());
    const fixture = defineManager('opening', (init) => {
      const bps = init.static.bps;
      const fac = bps.byId('core:str_t1_fac_land')!.index;
      const eng = bps.byId('core:lnd_t1_engineer')!.index;
      const slot = init.analysis.toWorld(12, 0);
      let queued = false;
      return (ctx) => {
        let vogt = 0;
        let factory = 0;
        let factoryIdle = false;
        let hasFactory = false;
        ctx.view.forEachOwn(null, (u) => {
          const b = bps.list[u.bp]!;
          if (b.categoryNames.includes('COMMAND')) vogt = u.order === 0 ? u.handle : 0;
          if (u.bp === fac) {
            hasFactory = true;
            if (u.complete) {
              factory = u.handle;
              factoryIdle = u.factoryBp < 0;
            }
          }
        });
        ctx.step(() => {
          if (vogt !== 0 && !hasFactory) ctx.emitter.build(vogt, fac, slot.x, slot.z, 0, Prio.P2);
          if (factory !== 0 && factoryIdle && !queued) ctx.emitter.factoryQueue(factory, eng, 2, Prio.P3);
          return () => {
            if (factory !== 0 && factoryIdle) queued = true;
          };
        });
      };
    });
    const brains: ReturnType<typeof createBrain>[] = [];
    const r = runMatch({
      map: 'setons',
      seed: 21,
      maxTicks: 800,
      sides: [
        {
          army: 0,
          source: (ctx) => {
            const brain = createBrain({ managers: [fixture] });
            brain.init(ctx.static, profileFor('normal', openings), { openings, openingId: 'eco_standard' });
            brains.push(brain);
            return new AiCommandSource({ brain, perceive: ctx.perceive });
          },
        },
        { army: 1, source: { commandsFor: () => [] } },
      ],
    });
    const m = r.metrics.armies[0]!;
    // think at 0, lead 3 ⇒ applied at tick 3, 30 s build
    expect(m.fac1Tick).toBe(303);
    expect(m.eng1Tick).not.toBeNull();
    expect(m.producedByRole['eng']).toBe(2);
    expect(r.log.commands.length).toBeGreaterThanOrEqual(2);
    expect(r.metrics.armies[0]!.commandsRejected).toBe(0);
    expect(brains[0]!.opening?.id).toBe('eco_standard');
    const re = replayMatch(r.log.setup, r.log);
    expect(re.hash).toBe(r.hash);
  });
});
