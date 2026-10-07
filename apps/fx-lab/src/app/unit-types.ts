/**
 * Unit types of the fx-lab contract (re-exported by context.ts). A separate module so that units.ts and
 * context.ts do not import each other (dependency-cruiser no-circular).
 */
export type LabUnitKind = 'tank' | 'bot' | 'arty' | 'engineer' | 'acu' | 'shieldgen' | 'structure' | 'wreck';

export interface LabUnitInit {
  kind: LabUnitKind;
  army: number;
  xWu: number;
  zWu: number;
  yaw: number;
  hp?: number;
  glow?: number;
}
