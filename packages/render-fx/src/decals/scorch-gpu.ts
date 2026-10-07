/**
 * GPU resources of the scorch/crater decal field (moved from the fx-lab so MS7 integrates it as is):
 * data and cell textures, FxScorch uniform buffer and bind group, upload on change, context-loss
 * restore from the CPU-packed arrays.
 */
import type { BindGroupH, BufH, GpuDevice, TexH } from '@faf/render';
import { SLOT_FX_SCORCH, UNIT_FX_SCORCH_CELLS, UNIT_FX_SCORCH_DATA } from '../core/slots.ts';
import { SCORCH_LAYOUT } from './scorch.ts';
import type { ScorchDecals } from './scorch.ts';

/** Ember intensity of the scorch glow on an HDR scene target (bloom) … */
export const SCORCH_EMBER_HDR = 4;
/** … and on the LDR fallback (no bloom, clamps at 1: a lower value keeps the glow's color). */
export const SCORCH_EMBER_LDR = 2.5;

/**
 * GPU side of the scorch field: data + cells textures (uploaded when the pool is dirty, restored from
 * the packed arrays after a context loss) and the FxScorch uniform block (written every frame).
 * Bind {@link group} in every pass whose shader includes SCORCH_GLSL (terrain FS; units
 * UNIT_FX_SCORCH_DATA/CELLS, UBO slot SLOT_FX_SCORCH).
 */
export class ScorchTextures {
  readonly dataTex: TexH;
  readonly cellsTex: TexH;
  readonly ubo: BufH;
  readonly group: BindGroupH;
  /** Texture uploads so far. */
  uploads = 0;
  private scorch: ScorchDecals;
  private readonly blockBytes: Uint8Array;

  constructor(
    private readonly dev: GpuDevice,
    scorch: ScorchDecals,
  ) {
    this.scorch = scorch;
    const d = scorch.dataTexture;
    const c = scorch.cellsTexture;
    this.dataTex = dev.createTexture({
      label: 'fx.scorch.data',
      width: d.width,
      height: d.height,
      format: d.format,
      filter: 'nearest',
      restore: (h) => this.uploadData(h),
    });
    this.cellsTex = dev.createTexture({
      label: 'fx.scorch.cells',
      width: c.width,
      height: c.height,
      format: c.format,
      filter: 'nearest',
      restore: (h) => this.uploadCells(h),
    });
    this.ubo = dev.createBuffer({ label: 'fx.scorch.ubo', usage: 'uniform', size: SCORCH_LAYOUT.size, dynamic: true });
    this.blockBytes = new Uint8Array(scorch.block);
    this.group = dev.createBindGroup({
      label: 'fx.scorch',
      buffers: [{ slot: SLOT_FX_SCORCH, buffer: this.ubo }],
      textures: [
        { unit: UNIT_FX_SCORCH_DATA, texture: this.dataTex },
        { unit: UNIT_FX_SCORCH_CELLS, texture: this.cellsTex },
      ],
    });
    scorch.pack();
    this.uploadData(this.dataTex);
    this.uploadCells(this.cellsTex);
  }

  /** Switches to another pool of the same capacity (scene switch). */
  setScorch(scorch: ScorchDecals): void {
    const a = scorch.dataTexture;
    const b = this.scorch.dataTexture;
    const c = scorch.cellsTexture;
    const d = this.scorch.cellsTexture;
    if (a.width !== b.width || a.height !== b.height || c.width !== d.width || c.height !== d.height) {
      throw new Error('ScorchTextures.setScorch: pool layout differs (same cap and map size required)');
    }
    this.scorch = scorch;
    scorch.pack();
    this.upload();
  }

  /** Packs and uploads when the pool changed; writes the uniform block. Call once per frame. */
  update(tS: number, hdr: boolean): void {
    if (this.scorch.dirty) {
      this.scorch.pack();
      this.upload();
    }
    this.scorch.writeBlock(tS, hdr ? SCORCH_EMBER_HDR : SCORCH_EMBER_LDR);
    this.dev.writeBuffer(this.ubo, 0, this.blockBytes);
  }

  private upload(): void {
    this.uploadData(this.dataTex);
    this.uploadCells(this.cellsTex);
    this.uploads++;
  }

  private uploadData(h: TexH): void {
    const d = this.scorch.dataTexture;
    this.dev.writeTexture(h, { x: 0, y: 0, width: d.width, height: d.height }, this.scorch.data);
  }

  private uploadCells(h: TexH): void {
    const c = this.scorch.cellsTexture;
    this.dev.writeTexture(h, { x: 0, y: 0, width: c.width, height: c.height }, this.scorch.cells);
  }

  destroy(): void {
    this.dev.destroyBindGroup(this.group);
    this.dev.destroyBuffer(this.ubo);
    this.dev.destroyTexture(this.dataTex);
    this.dev.destroyTexture(this.cellsTex);
  }
}
