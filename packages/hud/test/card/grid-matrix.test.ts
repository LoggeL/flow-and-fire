import { it, expect } from 'vitest';
import { resolveGridKey, resolveCardSpec } from '../../src/index.ts';
const build = resolveCardSpec(['core:cmd_commander'], null), key = { code: 'KeyQ', alt: false, shift: false, ctrl: false, meta: false }, base = { page: build.page, cells: build.cells, scheme: 'grid' as const, mode: 'idle' as const, textFocus: false, modal: false };
const orders = [['KeyQ', 'move'], ['KeyW', 'patrol'], ['KeyE', 'assist'], ['KeyR', 'reclaim'], ['KeyT', 'repair'], ['KeyA', 'attack'], ['KeyS', 'stop'], ['KeyD', 'pause'], ['KeyF', 'fireState'], ['KeyG', 'ability'], ['KeyZ', 'attackGround'], ['KeyX', 'tapshot'], ['KeyC', 'formation']] as const;
for (const [code, id] of orders) {
    it(`Alt ${code} resolves ${id} on a builder`, () => expect(resolveGridKey({ ...key, code, alt: true }, base)).toEqual({ kind: 'order', id }));
    it(`${code} resolves ${id} on order page`, () => expect(resolveGridKey({ ...key, code }, { ...base, page: 'orders' })).toEqual({ kind: 'order', id }));
}
for (const code of ['KeyB', 'KeyV'])
    it(`${code} never binds self destruct`, () => expect(resolveGridKey({ ...key, code, alt: true }, base)).toEqual({ kind: 'passthrough' }));
for (const code of ['Delete', 'Backspace'])
    it(`Ctrl ${code} self destruct`, () => expect(resolveGridKey({ ...key, code, ctrl: true }, base)).toEqual({ kind: 'selfDestruct' }));
for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD'])
    it(`WASD ${code} moves camera`, () => expect(resolveGridKey({ ...key, code }, { ...base, scheme: 'wasd' })).toEqual({ kind: 'camera' }));
it('modal and text editing own every key', () => { for (const code of ['KeyQ', 'Delete', 'Escape'])
    for (const guard of ['textFocus', 'modal'] as const)
        expect(resolveGridKey({ ...key, code, ctrl: true }, { ...base, [guard]: true })).toEqual({ kind: 'passthrough' }); });
