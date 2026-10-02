import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { loadFaction, buildEntry } from '../../../content/models/registry.ts';
import { compileContent } from '../../../packages/blueprints/scripts/content.ts';
import { parseGlb } from '../../../packages/client/src/assets/glb.ts';
import { transferablesOf } from '../../../packages/client/src/assets/messages.ts';
import { visualTableFromView } from '../../../packages/client/src/visuals.ts';
import { MESH_VERTEX_STRIDE, mergeMeshes, UNIT_DISPLAY_GAMMA } from '../../../packages/render/src/passes/units.ts';
import { createRenderer } from '../../../packages/render/src/renderer.ts';
import { FakeCanvas } from '../../../packages/render/test/support/fake-gl.ts';
import { acesFilm, compositeHdr, DISPLAY_GAMMA } from '../../../packages/render-fx/src/post/tonemap.ts';
import { fromModelkit, LIVE_VARKAN_MODELS, referencedModels } from '../../../tools/assets-pipeline/src/modelkit.ts';
import { REPO_ROOT } from '../../../tools/assets-pipeline/src/build.ts';
import { cubeBot } from '../../../tools/assets-pipeline/src/models.ts';
import { writeCompressedGlb, writeRawGlb } from '../../../tools/assets-pipeline/src/gltf.ts';

describe('existing Varkan art in the real Game asset contracts', () => {
  it('compiles only live references, preserves source scale/parts/LODs, and changes no sim bytes', async () => {
    const content = await compileContent({ includeTest: false });
    // ms6.4 content (independent ACU modules); model generation must preserve these bytes.
    expect(content.simHash).toBe(0x02629d13);
    expect(content.simBin).toEqual(new Uint8Array(await readFile(join(REPO_ROOT, 'content/generated/sim.bin'))));
    for (const [id, unit] of Object.entries(LIVE_VARKAN_MODELS)) {
      expect(content.view.visuals.find(v => v.id === id)?.mesh, id).toBe(`units/varkan/${unit}`);
    }
    const refs = content.view.visuals.flatMap(v => v.mesh === undefined ? [] : [v.mesh]);
    // The authored 8×8 land works of every tier are uniformly fitted to the 5×5 sim footprint.
    const factories = ['units/varkan/str_t1_fac_land', 'units/varkan/str_t2_fac_land', 'units/varkan/str_t3_fac_land'];
    const models = await referencedModels(refs, REPO_ROOT, new Map(factories.map(id => [id, [5, 5] as const])));
    expect(models.map(m => m.id).sort()).toEqual([...new Set(refs)].sort());
    expect(models).toHaveLength(18);
    expect(models.find(m => m.id === 'units/cube_bot')).toEqual(cubeBot());
    const faction = await loadFaction('varkan');
    for (const model of models.filter(m => m.forward === '+z')) {
      const built = buildEntry(faction, faction.models.find(m => m.def.id === model.sourceModelId)!);
      const scale = factories.includes(model.id) ? 5 / 8 : 1;
      expect(model.viewScale).toBe(scale);
      expect(model.parts.map(p => [p.name, p.parent, p.pivot, p.anim])).toEqual(built.parts.map(p => [p.name, p.parent, p.pivot.map(v => v * scale), p.anim]));
      expect(model.lods).toHaveLength(3);
      for (let lod = 0; lod < 3; lod++) {
        expect(model.lods[lod]!.positions).toEqual(Float32Array.from(built.lods[lod]!.positions, v => v * scale));
        expect(model.lods[lod]!.colors).toEqual(built.lods[lod]!.colors);
        expect(model.lods[lod]!.mask).toEqual(built.lods[lod]!.mask);
      }
      if (scale !== 1) {
        const mesh = parseGlb(await writeRawGlb(model), null).lods[0]!;
        expect(mesh.bounds[3] - mesh.bounds[0]).toBeLessThanOrEqual(5);
        expect(mesh.bounds[5] - mesh.bounds[2]).toBeLessThanOrEqual(5);
      }
    }
  });

  it('raw and meshopt models keep authored materials and rotate geometry, normals and part pivots consistently', async () => {
    const faction = await loadFaction('varkan');
    const built = buildEntry(faction, faction.models.find(m => m.unit === 'lnd_t1_tank')!);
    const model = fromModelkit('units/varkan/lnd_t1_tank', built);
    await MeshoptDecoder.ready;
    const raw = parseGlb(await writeRawGlb(model), null);
    const packed = parseGlb(await writeCompressedGlb(model), MeshoptDecoder);
    expect(raw.parts.map(p => p.pivot)).toEqual(built.parts.map(p => [p.pivot[2], p.pivot[1], -p.pivot[0]]));
    expect(raw.parts.map(p => p.anim)).toEqual(built.parts.map(p => p.anim));
    for (let l = 0; l < 3; l++) {
      const a = raw.lods[l]!, b = packed.lods[l]!, source = built.lods[l]!;
      expect(a.colors).toEqual(source.colors);
      expect(a.mask).toEqual(source.mask);
      expect(b.mask).toEqual(a.mask);
      expect(b.colors).toEqual(a.colors);
      expect(b.partIds).toEqual(a.partIds);
      for (let i = 0; i < a.vertexCount; i++) {
        expect([...a.positions.subarray(i * 3, i * 3 + 3)]).toEqual([source.positions[i * 3 + 2], source.positions[i * 3 + 1], -source.positions[i * 3]!]);
        for (let c = 0; c < 3; c++) expect(Math.abs(a.positions[i * 3 + c]! - b.positions[i * 3 + c]!)).toBeLessThan(0.001);
      }
      expect(a.normals[0]).toBe(source.normals[2]);
      expect(a.normals[2]).toBe(-source.normals[0]!);
    }
    const transferred = structuredClone({ t: 'model', requestId: 1, id: model.id, source: 'network', variant: 'raw', fallbackReason: null, lods: raw.lods, parts: raw.parts } as const,
      { transfer: transferablesOf({ t: 'model', requestId: 1, id: model.id, source: 'network', variant: 'raw', fallbackReason: null, lods: raw.lods, parts: raw.parts }) });
    expect(transferred.lods[0]!.colors).toEqual(built.lods[0]!.colors);
    const content = await compileContent({ includeTest: false });
    const visuals = visualTableFromView(content.view, new Map([[model.id, transferred]]));
    expect(visuals[content.view.visuals.findIndex(v => v.id === 'core:lnd_t1_tank')]!.meshes![0]!.mask).toEqual(built.lods[0]!.mask);
  });

  it('packs material channels for the GPU and keeps legacy benchmark shading distinguishable', async () => {
    const faction = await loadFaction('varkan');
    const model = fromModelkit('units/varkan/cmd_commander', buildEntry(faction, faction.models.find(m => m.unit === 'cmd_commander')!));
    const parsed = parseGlb(await writeRawGlb(model), null);
    const mesh = parsed.lods[0]!, merged = mergeMeshes([mesh]);
    const f32 = new Float32Array(merged.vertices), u8 = new Uint8Array(merged.vertices);
    for (let i = 0; i < mesh.vertexCount; i++) {
      const off = i * MESH_VERTEX_STRIDE;
      expect([...f32.subarray(off / 4 + 5, off / 4 + 8)]).toEqual([...mesh.colors!.subarray(i * 3, i * 3 + 3)]);
      expect(f32[off / 4 + 8]).toBe(1);
      expect([...u8.subarray(off + 36, off + 40)]).toEqual([...mesh.mask!.subarray(i * 4, i * 4 + 4)]);
    }
    expect(mesh.mask!.some((v, i) => i % 4 === 0 && v > 0)).toBe(true);
    expect(mesh.mask!.some((v, i) => i % 4 === 1 && v > 0)).toBe(true);
    const legacy = parseGlb(await writeRawGlb(cubeBot()), null);
    expect(new Float32Array(mergeMeshes(legacy.lods.slice(0, 1)).vertices)[8]).toBe(0);
  });

  it('hands linear authored materials to the display-referred scene without double decoding', async () => {
    const canvas = new FakeCanvas();
    const renderer = createRenderer(canvas);
    const sources = canvas.gl.named('shaderSource').map(call => call.args[1] as string);
    const vs = sources.find(source => source.includes('in vec4 a_color'))!;
    const fs = sources.find(source => source.includes('in vec3 v_emissive'))!;
    expect(UNIT_DISPLAY_GAMMA).toBe(DISPLAY_GAMMA);
    expect(vs).toContain('flat out uint v_authored;');
    expect(fs).toContain('flat in uint v_authored;');
    // Read the exponents actually submitted to the backend, rather than a separate CPU constant.
    const decode = Number(/vec3 teamLinear = pow\(.*vec3\(([\d.]+)\)\);/.exec(vs)?.[1]);
    const encode = Number(/if \(v_authored != 0u\) color = pow\(.*vec3\(1.0 \/ ([\d.]+)\)\);/.exec(fs)?.[1]);
    expect(decode).toBe(DISPLAY_GAMMA);
    expect(encode).toBe(DISPLAY_GAMMA);
    expect(fs.indexOf('color += v_emissive;')).toBeLessThan(fs.indexOf('if (v_authored != 0u) color'));
    expect(fs.indexOf('if (v_authored != 0u) color')).toBeLessThan(fs.indexOf('if (v_highlight != 0u)'));
    expect(fs.indexOf('if (v_authored != 0u) color')).toBeLessThan(fs.indexOf('float fog ='));
    expect(vs).toContain('v_albedo = a_partId == 0u ? albedo : albedo * 0.85;');
    renderer.dispose();

    const faction = await loadFaction('varkan');
    const lod = buildEntry(faction, faction.models.find(m => m.unit === 'cmd_commander')!).lods[0]!;
    let darkerWithoutEncoding = 0;
    // Actual authored hull, team, glow, metal and AO values under bounded reference lighting.
    for (let vertex = 0; vertex < lod.colors.length / 3; vertex++) {
      const [team, glow, metal, ao] = [...lod.mask.subarray(vertex * 4, vertex * 4 + 4)].map(v => v / 255);
      for (let channel = 0; channel < 3; channel++) {
        const base = lod.colors[vertex * 3 + channel]!;
        const tintDisplay = [0.25, 0.5, 1][channel]!;
        const albedo = base * (1 - team! + Math.pow(tintDisplay, decode) * team!);
        const lit = albedo * (0.35 * ao! + 0.55) + (0.04 * (1 - metal!) + albedo * metal!) * 0.1 * metal! + base * glow!;
        const scene = Math.pow(Math.max(lit, 0), 1 / encode);
        const actual = compositeHdr(scene, 1);
        const expected = Math.pow(acesFilm(lit), 1 / DISPLAY_GAMMA);
        expect(actual).toBeCloseTo(expected, 12);
        if (actual > compositeHdr(lit, 1) * 2 && actual > 0.1) darkerWithoutEncoding++;
      }
    }
    // The authored dark hull has observable contrast, not just a white/zero roundtrip.
    expect(darkerWithoutEncoding).toBeGreaterThan(100);
  });
});
