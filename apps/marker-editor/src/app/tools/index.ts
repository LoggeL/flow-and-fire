/** Tool state machines of the marker editor (one instance per ToolId). */
import type { ToolId } from '../../model/types.ts';
import { CircleFieldTool, PolygonFieldTool } from './field.ts';
import { DeleteTool, SpotTool, StartTool } from './place.ts';
import { SelectTool } from './select.ts';
import type { Tool } from './types.ts';

export { allFieldRefs, distPx, PanDrag, pointSegment, Press } from './common.ts';
export { CircleFieldTool, PolygonFieldTool } from './field.ts';
export { DeleteTool, SpotTool, StartTool } from './place.ts';
export { findEdge, SelectTool, type EdgeHit } from './select.ts';
export { CLOSE_POLYGON_PX, DRAG_THRESHOLD_PX, EDGE_PICK_PX, type PointerInput, type Tool, type ToolContext, type ToolEnv } from './types.ts';

/** A fresh set of all seven tools. */
export function createTools(): Readonly<Record<ToolId, Tool>> {
  return {
    select: new SelectTool(),
    start: new StartTool(),
    mass: new SpotTool('mass'),
    hydro: new SpotTool('hydro'),
    fieldCircle: new CircleFieldTool(),
    fieldPolygon: new PolygonFieldTool(),
    delete: new DeleteTool(),
  };
}
