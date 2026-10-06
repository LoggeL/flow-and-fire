/**
 * Builds `AiStatic` from map data (the fields of an .rtsmap / MapSimData) plus the blueprint table.
 * Used by test fixtures and the arena (`buildArenaStatic`). Adapter boundary: in MS9 the sim host
 * builds AiStatic from nav (passLowRes, sectors) and @faf/blueprints; this module then only remains
 * for tools.
 */
import { MAX_ARMIES } from '@faf/fixed';
import { mapClassOf } from '../openings.ts';
import type { AiBlueprintTable, AiStatic, MapClass, Spot, SpotKind, Vec2 } from '../types.ts';
import { computePassLowRes, DEFAULT_PASS_OPTIONS, heightLowRes, labelComponents, type PassOptions } from './passability.ts';

const FX_ONE = 4096;

export interface MapInputSpot {
  readonly kind: SpotKind;
  /** Fx raw (as stored in .rtsmap) — see `coords`. */
  readonly x: number;
  readonly z: number;
}

export interface MapInputStart {
  readonly army: number;
  readonly x: number;
  readonly z: number;
}

export interface AiStaticInput {
  readonly name: string;
  readonly sizeWu: number;
  readonly dim: number;
  readonly heights: Uint16Array;
  readonly heightScaleRaw: number;
  readonly waterLevelRaw: number | null;
  readonly spots: readonly MapInputSpot[];
  /** Map start markers (any order; sorted by army). */
  readonly starts: readonly MapInputStart[];
  /** Unit of spot/start coordinates: 'fxRaw' (.rtsmap, default) or 'wu'. */
  readonly coords?: 'fxRaw' | 'wu';
  readonly army: number;
  readonly gameSeed: number;
  /** Active armies of the skirmish setup (default: every army that has a start marker). */
  readonly activeArmies?: readonly number[];
  readonly bps: AiBlueprintTable;
  readonly pass?: PassOptions;
  /** Map class override (default: mapClassOf(name, sizeWu)). */
  readonly mapClass?: MapClass;
}

/** Builds AiStatic (passability, heights, components, spots, starts) for one army. */
export function createAiStatic(input: AiStaticInput): AiStatic {
  const pass = input.pass ?? DEFAULT_PASS_OPTIONS;
  const hin = {
    sizeWu: input.sizeWu,
    dim: input.dim,
    heights: input.heights,
    heightScaleRaw: input.heightScaleRaw,
    waterLevelRaw: input.waterLevelRaw,
  };
  const passLowRes = computePassLowRes(hin, pass);
  const passDim = Math.floor(input.sizeWu / pass.cellWu);
  const comps = labelComponents(passLowRes, passDim);
  const scale = (input.coords ?? 'fxRaw') === 'fxRaw' ? 1 / FX_ONE : 1;
  const spots: Spot[] = input.spots.map((s, index) => ({ index, kind: s.kind, x: s.x * scale, z: s.z * scale }));
  const sorted = [...input.starts].sort((a, b) => a.army - b.army);
  const starts: Vec2[] = sorted.map((s) => ({ x: s.x * scale, z: s.z * scale }));
  const armyStart: number[] = new Array<number>(MAX_ARMIES).fill(-1);
  const active = input.activeArmies ?? sorted.map((s) => s.army);
  for (const a of active) {
    const idx = sorted.findIndex((s) => s.army === a);
    if (idx < 0) throw new RangeError(`createAiStatic: army ${a} has no start marker`);
    armyStart[a] = idx;
  }
  if (armyStart[input.army] === -1) throw new RangeError(`createAiStatic: army ${input.army} is not active`);
  return {
    army: input.army,
    gameSeed: input.gameSeed >>> 0,
    map: { name: input.name, sizeWu: input.sizeWu, mapClass: input.mapClass ?? mapClassOf(input.name, input.sizeWu) },
    spots,
    passLowRes,
    passCellWu: pass.cellWu,
    passDim,
    heightLowRes: heightLowRes(hin, pass.cellWu),
    components: comps.labels,
    sectors: null,
    bps: input.bps,
    starts,
    armyStart,
    activeArmies: [...active].sort((a, b) => a - b),
  };
}

/** Same static knowledge for another army (shares the grids; only army/seed differ). */
export function staticForArmy(s: AiStatic, army: number, gameSeed: number = s.gameSeed): AiStatic {
  if (s.armyStart[army] === undefined || s.armyStart[army] === -1) throw new RangeError(`staticForArmy: army ${army} is not active`);
  return { ...s, army, gameSeed: gameSeed >>> 0 };
}
