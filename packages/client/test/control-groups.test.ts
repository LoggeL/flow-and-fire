import { describe, expect, it } from 'vitest';
import { FrameReader } from '@faf/protocol';
import { controlGroupChord } from '../src/actions.ts';
import { CommandBuilder } from '../src/commands.ts';
import { ControlGroups } from '../src/control-groups.ts';
import { Selection } from '../src/selection.ts';
import { FakeSimLink } from './support/fake-sim-link.ts';

describe('control groups', () => {
  it('stores, merges, recalls, centers on double tap and prunes killed handles', () => {
    const link = new FakeSimLink({ units: 4 }); const r = new FrameReader();
    r.reset(link.frames.poll()!); const hs = link.handles();
    const selection = new Selection(0); selection.onFrame(r);
    const groups = new ControlGroups();
    groups.save(1, [hs[0]!, hs[1]!]); groups.save(1, [hs[1]!, hs[2]!], true);
    expect(groups.snapshot()[1]).toEqual(hs.slice(0, 3));
    expect(groups.recall(1, selection, r, false, 100)).toBeNull();
    expect(Array.from(selection.selected())).toEqual(hs.slice(0, 3));
    expect(groups.recall(1, selection, r, false, 300)).toMatchObject({ x: expect.any(Number), z: expect.any(Number) });
    groups.save(2, [hs[3]!]); groups.recall(2, selection, r, true, 500);
    expect(selection.count).toBe(4);
    new CommandBuilder(link, 0).kill([hs[1]!]); link.tickNow(); r.reset(link.frames.poll()!); selection.onFrame(r);
    groups.prune(r, 0); expect(groups.snapshot()[1]).toEqual([hs[0], hs[2]]);
    expect(() => groups.save(10, [])).toThrow(RangeError);
  });
  it('uses physical digits, Ctrl/Alt save, Shift add and never captures Meta', () => {
    const chord = { code: 'Digit3', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(controlGroupChord(chord)).toEqual({ slot: 3, save: false, additive: false });
    expect(controlGroupChord({ ...chord, ctrlKey: true, shiftKey: true })).toEqual({ slot: 3, save: true, additive: true });
    expect(controlGroupChord({ ...chord, altKey: true })).toEqual({ slot: 3, save: true, additive: false });
    expect(controlGroupChord({ ...chord, metaKey: true })).toBeNull();
    expect(controlGroupChord({ ...chord, code: 'Numpad3' })).toBeNull();
  });
});
