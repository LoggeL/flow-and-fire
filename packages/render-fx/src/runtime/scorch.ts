import type { BufH, GpuDevice, TexH, TextureBinding, BufferBinding } from '@faf/render';
import { ScorchDecals, SCORCH_CAPS } from '../decals/scorch.ts';
import type { ScorchPreset } from '../decals/scorch.ts';
import { SLOT_FX_SCORCH } from '../core/slots.ts';
/** Genuine terrain shader inputs, preserving both CPU field and GPU uploads across context loss. */
export class ScorchGpu {
  readonly field: ScorchDecals;
  readonly buffers: readonly BufferBinding[];
  readonly textures: readonly TextureBinding[];
  private readonly data: TexH;
  private readonly cells: TexH;
  private readonly ubo: BufH;
  constructor(private readonly dev: GpuDevice, mapSizeWu: number, preset: ScorchPreset) {
    this.field = new ScorchDecals({ mapSizeWu, cap: SCORCH_CAPS[preset] });
    const field = this.field;
    this.data = dev.createTexture({ label: 'game.fx.scorch.data', ...field.dataTexture, restore: h => dev.writeTexture(h, {x:0,y:0,width:field.dataTexture.width,height:field.dataTexture.height}, field.data) });
    this.cells = dev.createTexture({ label: 'game.fx.scorch.cells', ...field.cellsTexture, restore: h => dev.writeTexture(h, {x:0,y:0,width:field.cellsTexture.width,height:field.cellsTexture.height}, field.cells) });
    this.ubo = dev.createBuffer({ label: 'game.fx.scorch', usage: 'uniform', size: field.block.byteLength, restore: h => dev.writeBuffer(h, 0, new Uint8Array(field.block)) });
    this.buffers = [{ slot: SLOT_FX_SCORCH, buffer: this.ubo }];
    // 14/15 leave the existing terrain decal units 10/11 and game shadow units 12/13 intact.
    this.textures = [{ unit: 14, texture: this.data }, { unit: 15, texture: this.cells }];
    this.update(0);
  }
  update(timeS: number): void {
    const field = this.field; field.update(timeS);
    if (field.dirty) { field.pack(); this.dev.writeTexture(this.data, {x:0,y:0,width:field.dataTexture.width,height:field.dataTexture.height}, field.data); this.dev.writeTexture(this.cells, {x:0,y:0,width:field.cellsTexture.width,height:field.cellsTexture.height}, field.cells); }
    this.dev.writeBuffer(this.ubo, 0, new Uint8Array(field.writeBlock(timeS)));
  }
  destroy(): void { this.dev.destroyTexture(this.data); this.dev.destroyTexture(this.cells); this.dev.destroyBuffer(this.ubo); }
}
