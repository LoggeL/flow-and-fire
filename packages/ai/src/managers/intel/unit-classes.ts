/**
 * Per-blueprint classification shared by the army/situation managers (factory, intel, platoon,
 * defense). Everything is derived once from category expressions and the roles of
 * ai-openings.json (ai.md §1 Leitplanke 2: roles and categories, never unit ids or names).
 *
 * Target values of ai.md §5.5 (platoon target choice, V_struct of the threat grid):
 * mex 100 + tech × 100 · engineer 60 · power generator 40 · land factory 80 · point defense −50
 * (+100 with ≥ 25 % artillery, handled by the caller) · enemy commander 300 (only at R ≥ 2, caller).
 * Documented additions (not in ai.md): hydrocarbon plant 40 (energy producer like Glutkessel), air
 * factory 80 (factory like Landwerk), any other non-wall structure 20, walls 0.
 */
import type { RoleTable } from '../../openings.ts';
import type { AiBlueprint, AiBlueprintTable } from '../../types.ts';

export const UC = {
  /** Mobile land unit that belongs into platoons (not scout, engineer or commander). */
  combatLand: 1 << 0,
  scout: 1 << 1,
  engineer: 1 << 2,
  commander: 1 << 3,
  /** Mobile indirect-fire unit (artillery share of a platoon). */
  arty: 1 << 4,
  air: 1 << 5,
  structure: 1 << 6,
  /** Direct-fire defense structure (Riegel). */
  pd: 1 << 7,
  factory: 1 << 8,
  landFactory: 1 << 9,
  mex: 1 << 10,
  /** Enemy "combat unit" for local defense: mobile, surface dps > 0, not a scout. */
  combatant: 1 << 11,
  /** Aircraft that attack ground (bomber or gunship) — snipe danger, burst check. */
  airStrike: 1 << 12,
  mobile: 1 << 13,
  /** Tech ≥ 2 tank (the "Meißel" overcharge trigger of ai.md §5.5). */
  heavyTank: 1 << 14,
  airFactory: 1 << 15,
} as const;

/** Classification tables indexed by blueprint index. */
export class UnitClasses {
  readonly flags: Uint32Array;
  /** Target value of ai.md §5.5 per blueprint (commander: 300; the caller applies R ≥ 2). */
  readonly value: Float64Array;
  readonly table: AiBlueprintTable;

  constructor(table: AiBlueprintTable, roles: RoleTable) {
    this.table = table;
    const n = table.list.length;
    this.flags = new Uint32Array(n);
    this.value = new Float64Array(n);
    const m = (src: string): ((bp: AiBlueprint) => boolean) => {
      const e = table.compile(src);
      return (bp) => table.matches(bp, e);
    };
    const isCombatLand = m('LAND & MOBILE - SCOUT - ENGINEER - COMMAND');
    const isAir = m('AIR & MOBILE');
    const isMobile = m('MOBILE');
    const isFactory = m('STRUCTURE & FACTORY');
    const isAirStrike = m('AIR & (BOMBER | GUNSHIP)');
    const isWall = m('WALL');
    const isEnergy = m('STRUCTURE & ENERGYPRODUCTION');
    const isCommander = m('COMMAND');
    for (const bp of table.list) {
      let f = 0;
      const scout = roles.isRole(bp, 'scout');
      if (isMobile(bp)) f |= UC.mobile;
      if (isCombatLand(bp) && !scout) f |= UC.combatLand;
      if (scout) f |= UC.scout;
      if (roles.isRole(bp, 'eng')) f |= UC.engineer;
      if (isCommander(bp)) f |= UC.commander;
      if (roles.isRole(bp, 'arty')) f |= UC.arty;
      if (isAir(bp)) f |= UC.air;
      if (bp.isStructure) f |= UC.structure;
      if (roles.isRole(bp, 'pd')) f |= UC.pd;
      if (isFactory(bp)) f |= UC.factory;
      if (roles.isRole(bp, 'fac_land')) f |= UC.landFactory;
      if (roles.isRole(bp, 'fac_air')) f |= UC.airFactory;
      if (roles.isRole(bp, 'mex')) f |= UC.mex;
      if (isMobile(bp) && bp.dpsSurface > 0 && !scout) f |= UC.combatant;
      if (isAirStrike(bp)) f |= UC.airStrike;
      if (roles.isRole(bp, 'tank') && bp.tech >= 2) f |= UC.heavyTank;
      this.flags[bp.index] = f;

      let v = 0;
      if ((f & UC.mex) !== 0) v = 100 + bp.tech * 100;
      else if ((f & UC.commander) !== 0) v = 300;
      else if ((f & UC.engineer) !== 0) v = 60;
      else if ((f & UC.factory) !== 0) v = 80;
      else if ((f & UC.pd) !== 0) v = -50;
      else if (bp.isStructure && isEnergy(bp)) v = 40;
      else if (bp.isStructure && !isWall(bp)) v = 20;
      this.value[bp.index] = v;
    }
  }

  has(bp: number, flag: number): boolean {
    return bp >= 0 && (this.flags[bp]! & flag) !== 0;
  }

  bp(index: number): AiBlueprint {
    return this.table.list[index]!;
  }
}

const cache = new WeakMap<RoleTable, UnitClasses>();

/** Shared classification per role table (built once per brain). */
export function unitClassesFor(roles: RoleTable): UnitClasses {
  let c = cache.get(roles);
  if (c === undefined) {
    c = new UnitClasses(roles.table, roles);
    cache.set(roles, c);
  }
  return c;
}
