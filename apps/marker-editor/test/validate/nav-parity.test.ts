/**
 * The editor's reachability model against the game's pathfinder (MS3 packages/nav): for the four
 * maps and every size class, the cell passability, the clearance (capped at 3) and the component
 * labels (editor label + 1 == nav label) must be identical, and so must the cell rule of
 * @faf/rules (isLandCellBlocked) and nav's terrainCell.
 *
 * packages/nav is not part of this branch yet (MS3 runs in parallel) and not a dependency of the
 * editor, so the module is loaded by path: FAF_NAV_SRC (e.g. the MS3 worktree's
 * packages/nav/src/index.ts) or <repo>/packages/nav/src/index.ts once MS3 is merged. Without it
 * the test is skipped (reported as skipped, never silently green).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RtsMap } from '@faf/formats';
import { isLandCellBlocked } from '@faf/rules';
import { describe, expect, it } from 'vitest';
import { createTerrainAnalysis, heightfieldOf, NAV_CLASS_MAX } from '../../src/validate/index.ts';
import { loadMap, MAP_NAMES } from './helpers.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const NAV_SRC = process.env['FAF_NAV_SRC'] ?? resolve(REPO_ROOT, 'packages/nav/src/index.ts');
const HAVE_NAV = existsSync(NAV_SRC);

interface NavLike {
  clearanceAt(x: number, z: number): number;
  isPassable(cls: number, x: number, z: number): boolean;
  componentAt(cls: number, x: number, z: number): number;
}
interface NavModule {
  createStandaloneNav(map: unknown): { nav: NavLike };
  terrainCell(map: unknown, x: number, z: number): number;
  NAV_MAX_CLEARANCE: number;
  NAV_COMP_OVERFLOW: number;
}

function navInput(map: RtsMap): unknown {
  return { ...heightfieldOf(map), waterLevelRaw: map.meta.waterLevelRaw };
}

describe.skipIf(!HAVE_NAV)(`editor reachability == nav (${NAV_SRC})`, () => {
  it.each(MAP_NAMES)('%s: cell rule, clearance and components per class agree with nav', async (name) => {
    const nav = (await import(pathToFileURL(NAV_SRC).href)) as NavModule;
    const map = loadMap(name);
    const input = navInput(map);
    const { nav: n } = nav.createStandaloneNav(input);
    const size = map.meta.sizeWu;
    const hf = heightfieldOf(map);
    let ruleDiff = 0;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        if (isLandCellBlocked(hf, map.meta.waterLevelRaw, x, z) !== (nav.terrainCell(input, x, z) === 0)) ruleDiff++;
      }
    }
    expect(ruleDiff, 'rules.isLandCellBlocked vs nav terrainCell').toBe(0);
    for (let cls = 1; cls <= NAV_CLASS_MAX; cls++) {
      const a = createTerrainAnalysis(map, { navClass: cls });
      let passDiff = 0;
      let clearDiff = 0;
      let labelDiff = 0;
      let overflow = 0;
      for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
          const i = z * size + x;
          if ((a.passable[i] === 1) !== n.isPassable(cls, x, z)) passDiff++;
          if (a.clearance[i] !== Math.min(NAV_CLASS_MAX, n.clearanceAt(x, z))) clearDiff++;
          const navLabel = n.componentAt(cls, x, z);
          if (navLabel === nav.NAV_COMP_OVERFLOW) overflow++;
          else if (a.labels[i]! + 1 !== navLabel) labelDiff++;
        }
      }
      expect({ cls, passDiff, clearDiff, labelDiff, overflow }).toEqual({ cls, passDiff: 0, clearDiff: 0, labelDiff: 0, overflow: 0 });
    }
  });
});
