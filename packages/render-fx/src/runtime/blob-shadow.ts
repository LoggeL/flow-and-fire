import { FRAME_BLOCK_GLSL, SLOT_FRAME, vf } from '@faf/render';
import type { BindGroupH, GpuDevice, PassEncoder, PipeH, BufH } from '@faf/render';
import { DynamicInstanceBuffer } from '../core/instance-buffer.ts';
const VS = `#version 300 es
precision highp float;
precision highp int;
${FRAME_BLOCK_GLSL}
layout(location=0) in ivec3 a_pos;
layout(location=1) in float a_radius;
out vec2 v_uv;
void main(){
 vec2 q=vec2(float(gl_VertexID & 1),float((gl_VertexID >> 1)&1))*2.0-1.0;
 v_uv=q;
 vec3 p=vec3(a_pos-u_camPosInt.xyz)/4096.0;
 p.xz+=q*a_radius;
 gl_Position=u_viewProj*vec4(p,1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;
void main(){float a=0.3*(1.0-smoothstep(0.1,1.0,length(v_uv)));o_color=vec4(0.0,0.0,0.0,a);}`;
/** Medium preset's projected ground discs for visible units, using the real map height. */
export class BlobShadowPass {
  private readonly instances: DynamicInstanceBuffer;
  private readonly pipeline: PipeH;
  private readonly group: BindGroupH;
  private count = 0;
  constructor(private readonly dev: GpuDevice, frameUbo: BufH, capacity = 16384) {
    this.instances = new DynamicInstanceBuffer(dev, { label: 'game.fx.blob', stride: 16, capacity });
    this.pipeline = dev.createPipeline({label:'game.fx.blob',vertex:VS,fragment:FS,
      streams:[{stride:16,stepMode:'instance',attributes:[{location:0,format:vf('i32',3,'int'),offset:0},{location:1,format:vf('f32',1,'float'),offset:12}]}],
      uniformBlocks:[{name:'Frame',slot:SLOT_FRAME}],primitive:'triangle-strip',cullMode:'none',depthTest:true,depthCompare:'lequal',depthWrite:false,blend:'premultiplied'});
    this.group=dev.createBindGroup({buffers:[{slot:SLOT_FRAME,buffer:frameUbo}]});
  }
  begin(): void { this.count=0; }
  add(xRaw:number,yRaw:number,zRaw:number,radiusWu:number):void {
    if(this.count>=this.instances.capacity)return;
    const o=this.count++*4; const {i32,f32}=this.instances;
    i32[o]=xRaw;i32[o+1]=yRaw+32;i32[o+2]=zRaw;f32[o+3]=radiusWu;
  }
  encode(encoder:PassEncoder):number {
    if(this.count===0)return 0;
    this.instances.upload(this.count);encoder.setPipeline(this.pipeline);encoder.setBindGroup(this.group);
    encoder.setVertexStreams([{buffer:this.instances.buffer,offset:0}]);encoder.drawInstanced(4,this.count);return 1;
  }
  destroy():void{this.instances.destroy();this.dev.destroyPipeline(this.pipeline);this.dev.destroyBindGroup(this.group);}
}
