import { createAiStatic, labelComponents, type AiStatic, type OpeningsDoc } from '@faf/ai';
import { MT_START_COUNT, MAP_POINT_WORDS, WH_ARMY_COUNT, WH_SEED } from '@faf/sim';
import type { SimCore } from '../core.ts';
import { gameBlueprints } from './blueprints.ts';

/** Public terrain and lobby starts. No dynamic nav footprints or enemy world columns are copied. */
export function gameAiStatic(core: SimCore, army: number, openings: OpeningsDoc): AiStatic {
  const w = core.world, t = w.terrain, size = w.mapSizeWu;
  const starts = Array.from({length:w.mapTerrain.i32[MT_START_COUNT]!}, (_,i) => ({army:w.mapStarts.i32[i*MAP_POINT_WORDS]!, x:w.mapStarts.i32[i*MAP_POINT_WORDS+1]!, z:w.mapStarts.i32[i*MAP_POINT_WORDS+2]!}));
  const s = createAiStatic({ name:core.mapName, sizeWu:size, dim:t.dim, heights:t.heights, heightScaleRaw:t.heightScaleRaw,
    waterLevelRaw:w.hasWater?w.waterLevel:null, spots:core.map.meta.spots, starts, army,
    gameSeed:w.header.i32[WH_SEED]!, activeArmies:Array.from({length:w.header.i32[WH_ARMY_COUNT]!},(_,i)=>i), bps:gameBlueprints(w.bp,openings,w.armies.col.incomeFactor[army]!) });
  // Use authoritative immutable terrain, rather than the provisional 2-WU terrain policy.
  for(let z=0;z<s.passDim;z++) for(let x=0;x<s.passDim;x++) {
    let pass=1;
    for(let dz=0;dz<2;dz++) for(let dx=0;dx<2;dx++) if(w.navTerrain[(z*2+dz)*size+x*2+dx]===0) pass=0;
    s.passLowRes[z*s.passDim+x]=pass;
  }
  const spots = new Int32Array(core.map.meta.spots.length*3);
  core.map.meta.spots.forEach((p,i)=>{spots[i*3]=p.kind==='mass'?0:1;spots[i*3+1]=p.x;spots[i*3+2]=p.z;});
  return {...s,alliedArmies:s.activeArmies.filter(a=>w.alliance.u8[army*16+a]===1),components:labelComponents(s.passLowRes,s.passDim).labels,placement:{
    terrain:{...t,heights:t.heights.slice()}, waterLevelRaw:w.hasWater?w.waterLevel:null,
    terrainCells:w.navTerrain.slice(), spots,spotCount:core.map.meta.spots.length,
    maxSlopeRaw:w.bp.maxSlopeCol.slice(),spotKind:w.bp.spotKindCol.slice(),
  }};
}
