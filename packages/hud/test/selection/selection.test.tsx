// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { SelectionPanel, FactoryQueue, createHudModel, seedHud } from '../../src/index.ts';
import { renderWithHud, fireEvent } from '../support/index.tsx';
it('multi-selection respects modifier commands and queue add/remove quantities', () => { const m = createHudModel(); seedHud(m, 'armee'); const r = renderWithHud(<SelectionPanel />, { model: m }); const tile = r.container.querySelector<HTMLButtonElement>('.tile[data-type]'); expect(tile).not.toBeNull(); {
    fireEvent.click(tile!, { ctrlKey: true });
    expect(r.log.at(-1)?.name).toBe('selectDamagedOfType');
} r.unmount(); const q = renderWithHud(<FactoryQueue />, { model: m }); const block = q.container.querySelector<HTMLButtonElement>('.fqi'); expect(block).not.toBeNull(); fireEvent.contextMenu(block!, { shiftKey: true, button: 2 }); expect(q.log.at(-1)?.name).toBe('queueRemove'); expect(q.log.at(-1)?.args[1]).toBe(5); });
