import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SKIRMISH_RULES, type SkirmishConfig } from '@faf/hud';
import { TEAM_COLORS } from '@faf/modelkit';
import { DEFAULT_ARMY_COLORS, PALETTE_LAYOUT, createRenderer } from '@faf/render';
import { FrameWriter, frameCapacityBytes } from '@faf/protocol';
import { GameClient } from '@faf/client';
import { armyColorsForSkirmish, chosenArmyColor } from '../src/army-colors.ts';
import { FakeCanvas as GlCanvas } from '../../../packages/render/test/support/fake-gl.ts';
import { FakeSimLink } from '../../../packages/client/test/support/fake-sim-link.ts';
import { FakeCanvas, FakeRenderer, FakeTarget, ManualRaf } from '../../../packages/client/test/support/fakes.ts';

function config(colors: readonly string[]): SkirmishConfig {
  return { mapId: 'testplane', rules: DEFAULT_SKIRMISH_RULES, slots: colors.map((color, army) => ({
    index: 7 - army, name: `Army ${army}`, faction: 'varkan', color, team: 1,
    start: colors.length - 1 - army, controller: 'human', ai: null,
  })) };
}

function uploadedArmyColors(canvas: GlCanvas): number[][] {
  const data = [...canvas.gl.state.bufferData.entries()].find(([buffer, bytes]) =>
    buffer.gen === canvas.gl.generation && bytes.byteLength === PALETTE_LAYOUT.size)?.[1];
  expect(data).toBeDefined();
  const floats = new Float32Array(data!.buffer, data!.byteOffset, data!.byteLength / 4);
  return Array.from({ length: DEFAULT_ARMY_COLORS.length }, (_, army) =>
    Array.from(floats.subarray(army * 4, army * 4 + 3)));
}

describe('accepted skirmish army display palette', () => {
  it('matches all eight model palette colors and HUD tokens', () => {
    const tokens = readFileSync(new URL('../../../packages/hud/src/styles/tokens.css', import.meta.url), 'utf8');
    for (const color of TEAM_COLORS) {
      expect(chosenArmyColor(color.key)).toBe(Number.parseInt(color.hex.slice(1), 16));
      expect(tokens.toLowerCase()).toContain(color.hex.toLowerCase());
    }
    expect(chosenArmyColor('unknown')).toBeUndefined();
    expect(chosenArmyColor('constructor')).toBeUndefined();
    expect(armyColorsForSkirmish(undefined)).toBeUndefined();
  });

  it('uploads colors in actual army array order and retains them after context restore', () => {
    const colors = armyColorsForSkirmish(config(TEAM_COLORS.map(color => color.key)))!;
    const canvas = new GlCanvas(), renderer = createRenderer(canvas, { armyColors: colors });
    const verify = () => {
      const uploaded = uploadedArmyColors(canvas);
      TEAM_COLORS.forEach((color, army) => {
        const hex = Number.parseInt(color.hex.slice(1), 16);
        [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].forEach((channel, i) =>
          expect(uploaded[army]![i]).toBeCloseTo(channel / 255, 6));
      });
      DEFAULT_ARMY_COLORS[8]!.forEach((channel, i) => expect(uploaded[8]![i]).toBeCloseTo(channel, 6));
    };
    verify(); canvas.gl.lose(); canvas.gl.restore(); verify(); renderer.dispose();
  });

  it('uses deterministic legacy fallback for an unknown saved choice', () => {
    const colors = armyColorsForSkirmish(config(['orange', 'unknown']))!;
    expect(colors[0]).toBe(0xe07a1f);
    const rgb = DEFAULT_ARMY_COLORS[1]!;
    expect(colors[1]).toBe((Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255));
  });

  it('uses the chosen live house color for a move marker and respects explicit marker overrides', () => {
    for (const markerColor of [undefined, 0x123456]) {
      const link = new FakeSimLink({ units: 1 }), renderer = new FakeRenderer();
      const client = new GameClient({ canvas: new FakeCanvas(), keyTarget: new FakeTarget(), renderer,
        link, playerArmy: 0, armyColors: armyColorsForSkirmish(config(['olive']))!,
        ...(markerColor !== undefined ? { markerColor } : {}),
        visuals: [{ spec: { hull: 'box', size: [1, 1, 1] } }], raf: new ManualRaf(), focusProbe: () => null, now: () => 100 });
      link.advance(100); client.frame(100); client.selection.selectAll();
      client.moveTo(20 * 4096, 20 * 4096); client.frame(150);
      expect(renderer.last?.overlays?.markers[0]?.color).toBe(markerColor ?? 0x8a8f2e);
      expect(client.dynamicDecals.argb[0]! & 0xffffff).toBe(markerColor ?? 0x8a8f2e);
      client.dispose();
    }
  });

  it('paints live and accepted replay selection rings with each unit army color', () => {
    for (const scenario of [
      { readOnlyCommands: false, colors: ['orange', 'violet'] },
      { readOnlyCommands: true, colors: ['orange', 'violet'] },
      { readOnlyCommands: true, colors: undefined },
    ]) {
      const { readOnlyCommands, colors } = scenario;
      const link = new FakeSimLink({ units: 0 });
      const palette = colors === undefined ? undefined : armyColorsForSkirmish(config(colors));
      const expected = colors === undefined ? DEFAULT_ARMY_COLORS.slice(0, 2).map(rgb =>
        (Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255)) : [0xe07a1f, 0x7a4cc2];
      const client = new GameClient({ canvas: new FakeCanvas(), keyTarget: new FakeTarget(), renderer: new FakeRenderer(),
        link, playerArmy: 0, readOnlyCommands, ...(palette !== undefined ? { armyColors: palette } : {}),
        visuals: [{ spec: { hull: 'box', size: [1, 1, 1] } }], raf: new ManualRaf(), focusProbe: () => null });
      const caps = { units: 2, parts: 0, projectiles: 0, beams: 0, events: 0, debugBytes: 0 };
      const writer = new FrameWriter(caps), bytes = new Uint8Array(frameCapacityBytes(caps));
      let seq = 0;
      const present = (viewer: number) => {
        writer.beginFrame(bytes, ++seq, seq * 10, 0, 1000, viewer, 0, 0, 0, 0);
        for (const army of [0, 1]) writer.writeUnit(65536, 0, 65536, 65536, 0, 65536, 0, 0, 0, army,
          255, 255, 0, 0, army + 42, 0, 0);
        link.frames.deliver(bytes, seq, writer.endFrame()); client.frame(seq * 100);
      };
      present(0); client.selectHandles([42]); client.frame(150);
      expect(client.dynamicDecals.argb[0]! & 0xffffff).toBe(expected[0]);
      present(1); client.selectHandles([readOnlyCommands ? 43 : 42]); client.frame(250);
      expect(client.dynamicDecals.argb[0]! & 0xffffff).toBe(expected[readOnlyCommands ? 1 : 0]);
      if (readOnlyCommands) {
        present(-1); client.selectHandles([42, 43]); client.frame(350);
        expect(Array.from(client.dynamicDecals.argb.subarray(0, 2), argb => argb & 0xffffff)).toEqual(expected);
      }
      expect(link.sentBatches).toEqual([]);
      client.dispose();
    }
  });
});
