/** Synthetic tournament records for aggregation tests. */
import type { GameRecord, SideRecord } from '../../src/tournament/index.ts';

export function side(army: 0 | 1, o: Partial<SideRecord> = {}): SideRecord {
  return {
    army,
    contestant: army === 0 ? 'A' : 'B',
    label: 'normal',
    profile: 'normal',
    opening: 'eco_standard',
    defeated: false,
    t2Tick: 6000,
    firstWaveTick: 3000,
    firstWaveUnits: 8,
    firstWaveForced: false,
    waves: 3,
    retreats: 0,
    fac1Tick: 400,
    mex8Tick: 2400,
    idleEngineerPct: 5,
    engineerIdleTicks: 50,
    engineerAliveTicks: 1000,
    energyStallPct: 1,
    energyStallTicks: 10,
    energyCountedTicks: 1000,
    overflowPct: 0,
    massBpStallPct: 0,
    apmWindows: [20, 30, 40],
    apmMax: 40,
    apmCap: 120,
    thinks: 100,
    opsP50: 300,
    opsP99: 900,
    opsMax: 1200,
    budgetTotal: 24000,
    opsByManager: [{ name: 'platoon', thinks: 100, p99: 400, max: 500, budget: 5000 }],
    aiTimeouts: 0,
    timeoutTicks: [],
    thinkMsP50: 0.1,
    thinkMsP95: 0.4,
    thinkMsMax: 2,
    unitsProduced: 40,
    unitsLost: 10,
    commandsRejected: 0,
    ...o,
  };
}

export interface GameOpts {
  readonly seed?: number;
  readonly map?: string;
  readonly swapped?: boolean;
  readonly winner?: number;
  readonly mirror?: boolean;
  readonly pairing?: string;
  readonly sides?: readonly [Partial<SideRecord>, Partial<SideRecord>];
  readonly crash?: string;
}

export function game(i: number, o: GameOpts = {}): GameRecord {
  const seed = o.seed ?? Math.floor(i / 2) + 1;
  const swapped = o.swapped ?? i % 2 === 1;
  const mirror = o.mirror ?? true;
  const armyA: 0 | 1 = mirror ? 0 : swapped ? 1 : 0;
  const sampledArmy: 0 | 1 = mirror ? (seed % 2 === 0 ? 0 : 1) : armyA;
  const base = {
    game: i,
    suite: 'test',
    pairing: o.pairing ?? 'normal-vs-normal',
    mirror,
    seed,
    map: o.map ?? 'setons',
    swapped,
    armyA,
    starts: (mirror && swapped ? [1, 0] : [0, 1]) as [number, number],
    aiSeed: seed,
    host: 'sync' as const,
    clock: 'thread' as const,
    maxTicks: 18000,
    sampledArmy,
  };
  if (o.crash !== undefined) return { ...base, crash: o.crash, winner: -1, endTick: 0, endReason: 'crash', commands: 0, sides: [] };
  const s0 = side(0, { contestant: armyA === 0 ? 'A' : 'B', ...(o.sides?.[0] ?? {}) });
  const s1 = side(1, { contestant: armyA === 1 ? 'A' : 'B', ...(o.sides?.[1] ?? {}) });
  return { ...base, crash: null, winner: o.winner ?? -1, endTick: 18000, endReason: 'maxTicks', commands: 1000, sides: [s0, s1] };
}

/** `n` mirror games of which the sampled side reaches T2 ≤ 12 min in exactly `ok` games. */
export function t2Games(n: number, ok: number): GameRecord[] {
  const out: GameRecord[] = [];
  for (let i = 0; i < n; i++) {
    const g = game(i);
    const t2 = i < ok ? 7000 : 7300;
    const sides = g.sides.map((s) => (s.army === g.sampledArmy ? { ...s, t2Tick: t2 } : { ...s, t2Tick: 9000 })) as SideRecord[];
    out.push({ ...g, sides });
  }
  return out;
}
