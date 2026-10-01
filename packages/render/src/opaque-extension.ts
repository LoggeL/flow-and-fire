/** Optional shading owned by an application above render. No effect-package dependency. */
import type { BindGroupH, GpuDevice, PipeH, PipelineDesc, SamplerBinding, UniformBlockBinding } from './rhi/types.ts';
export interface OpaqueShaderExtension {
  /** GLSL declarations, including `float renderSunVisibility(vec3 position, vec3 normal)`. */
  readonly declarations: string;
  readonly uniformBlocks: readonly UniformBlockBinding[];
  readonly samplers: readonly SamplerBinding[];
  readonly bindGroup: BindGroupH;
  /** Optional terrain-only color transform before fog. */
  readonly terrainDeclarations?: string;
}
export class OpaquePipelineExtension {
  pipeline: PipeH | null = null;
  group: BindGroupH | null = null;
  constructor(private readonly dev: GpuDevice, private readonly base: PipelineDesc,
    private readonly position: string, private readonly normal: string) {}
  set(extension: OpaqueShaderExtension | null): void {
    const pipeline = extension === null ? null : this.dev.createPipeline({ ...this.base,
      fragment: this.base.fragment.replace('void main() {', `${extension.declarations}\n${this.position === 'v_pos' ? extension.terrainDeclarations ?? '' : ''}\nvoid main() {`)
        .replace(`float ndl = max(dot(${this.normal}, u_sunDir.xyz), 0.0);`,
          `float ndl = max(dot(${this.normal}, u_sunDir.xyz), 0.0) * renderSunVisibility(${this.position}, ${this.normal});`)
        .replace('float dist = length(v_pos - u_camFrac.xyz);', extension.terrainDeclarations === undefined ? 'float dist = length(v_pos - u_camFrac.xyz);' : 'color = renderGroundColor(color, v_pos - u_camFrac.xyz);\n  float dist = length(v_pos - u_camFrac.xyz);'),
      uniformBlocks: [...(this.base.uniformBlocks ?? []), ...extension.uniformBlocks],
      samplers: [...(this.base.samplers ?? []), ...extension.samplers] });
    if (this.pipeline !== null) this.dev.destroyPipeline(this.pipeline);
    this.pipeline = pipeline; this.group = extension?.bindGroup ?? null;
  }
  destroy(): void { this.set(null); }
}
