// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createRecordingCommands } from '../../src/commands/index.ts';
import { CARD_DEMOS, DEMO_GROUPS, applyCardDemo, applyStripDemo, createCardDemoCommands } from '../../src/demo/card.ts';
import type { CardDemoId } from '../../src/demo/card.ts';
import { CommandCard } from '../../src/hud/card/CommandCard.tsx';
import { cardSpec } from '../../src/hud/card/spec.ts';
import { handleHotkey, useCardHotkeys } from '../../src/hud/card/useCardHotkeys.ts';
import { createHudModel } from '../../src/model/index.ts';
import type { HudModel } from '../../src/model/index.ts';
import { fakeClock, fireEvent, flushSignals, lastCall, renderWithHud } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function demo(id: CardDemoId): HudModel {
  const m = createHudModel({ units: CAT });
  applyCardDemo(m, id);
  return m;
}

function keyEvent(code: string, mods: { alt?: boolean; shift?: boolean; ctrl?: boolean; type?: string; target?: EventTarget | null } = {}) {
  let prevented = false;
  return {
    e: {
      code,
      altKey: mods.alt ?? false,
      shiftKey: mods.shift ?? false,
      ctrlKey: mods.ctrl ?? false,
      metaKey: false,
      type: mods.type ?? 'keydown',
      repeat: false,
      target: mods.target ?? null,
      preventDefault: () => {
        prevented = true;
      },
    },
    prevented: () => prevented,
  };
}

describe('handleHotkey: resolvers bound to model and commands', () => {
  it('Vogt: W → cardActivate, Alt+S → stop, Alt+B nothing (prevented), Esc in placement → cancelMode', () => {
    const m = demo('vogt');
    const rec = createRecordingCommands();
    const opts = { mac: false, strip: true };
    const w = keyEvent('KeyW');
    expect(handleHotkey(w.e, m, rec.commands, opts)).toEqual({ kind: 'card', slot: 'KeyW', mods: { shift: false, ctrl: false, alt: false, button: 0 } });
    expect(lastCall(rec.log, 'cardActivate')?.args[0]).toBe('KeyW');
    expect(w.prevented()).toBe(true);
    handleHotkey(keyEvent('KeyS', { alt: true }).e, m, rec.commands, opts);
    expect(lastCall(rec.log, 'activateOrder')?.args[0]).toBe('stop');
    const altB = keyEvent('KeyB', { alt: true });
    const n = rec.log.length;
    handleHotkey(altB.e, m, rec.commands, opts);
    expect(rec.log.length).toBe(n);
    expect(altB.prevented()).toBe(true);
    m.card.armedSlot.value = 'KeyW';
    handleHotkey(keyEvent('Escape').e, m, rec.commands, opts);
    expect(lastCall(rec.log, 'cancelMode')).toBeDefined();
  });

  it('Ctrl+Delete → activateOrder(selfDestruct, ctrl); strip keys reach strip commands', () => {
    const m = demo('army');
    const rec = createRecordingCommands();
    const opts = { mac: false, strip: true };
    handleHotkey(keyEvent('Delete', { ctrl: true }).e, m, rec.commands, opts);
    expect(lastCall(rec.log, 'activateOrder')?.args).toEqual(['selfDestruct', { shift: false, ctrl: true, alt: false, button: 0 }]);
    handleHotkey(keyEvent('F3', { shift: true }).e, m, rec.commands, opts);
    expect(lastCall(rec.log, 'filter')?.args).toEqual(['air', true]);
    const alt4 = keyEvent('Digit4', { alt: true });
    handleHotkey(alt4.e, m, rec.commands, opts);
    expect(lastCall(rec.log, 'saveGroup')?.args).toEqual([3, false]);
    expect(alt4.prevented()).toBe(true);
    handleHotkey(keyEvent('Period').e, m, rec.commands, opts);
    expect(lastCall(rec.log, 'selectIdleEngineer')?.args).toEqual([false]);
  });

  it('text fields keep their keys; the Esc menu (modal) blocks the grid', () => {
    const m = demo('vogt');
    const rec = createRecordingCommands();
    const input = document.createElement('input');
    const k = keyEvent('KeyQ', { target: input });
    handleHotkey(k.e, m, rec.commands, { mac: false, strip: true });
    expect(rec.log).toHaveLength(0);
    expect(k.prevented()).toBe(false);
    m.menus.gameMenu.open.value = true;
    handleHotkey(keyEvent('KeyQ').e, m, rec.commands, { mac: false, strip: true });
    expect(rec.log).toHaveLength(0);
  });

  it('Alt keyup is prevented (Firefox menu bar)', () => {
    const up = keyEvent('AltLeft', { type: 'keyup' });
    handleHotkey(up.e, demo('vogt'), createRecordingCommands().commands, { mac: false, strip: true });
    expect(up.prevented()).toBe(true);
  });
});

function HotkeyHost(): null {
  useCardHotkeys(document);
  return null;
}

describe('useCardHotkeys', () => {
  it('binds keydown on the target while mounted', () => {
    const m = demo('landFactory');
    const { log, unmount } = renderWithHud(
      <>
        <HotkeyHost />
        <CommandCard />
      </>,
      { model: m },
    );
    fireEvent.keyDown(document, { code: 'KeyQ', shiftKey: true });
    expect(lastCall(log, 'cardActivate')?.args).toEqual(['KeyQ', { shift: true, ctrl: false, alt: false, button: 0 }]);
    unmount();
    const n = log.length;
    fireEvent.keyDown(document, { code: 'KeyQ' });
    expect(log.length).toBe(n);
  });
});

describe('demo data and demo commands', () => {
  it('every demo resolves to the page it names', () => {
    const pages: Record<CardDemoId, string> = {
      empty: 'empty',
      vogt: 'build',
      engineerT2: 'build',
      engineerT3: 'build',
      mixedBuilders: 'build',
      landFactory: 'production',
      airFactory: 'production',
      mex: 'structure',
      radar: 'structure',
      army: 'orders',
      capReached: 'production',
      placement: 'build',
      selfDestruct: 'orders',
    };
    for (const id of Object.keys(CARD_DEMOS) as CardDemoId[]) {
      expect(cardSpec(demo(id)).value.page, id).toBe(pages[id]);
    }
    expect(cardSpec(demo('engineerT2')).value.tab).toBe(2);
    expect(cardSpec(demo('mixedBuilders')).value.headTypeId).toBe('core:lnd_t2_engineer');
    expect(DEMO_GROUPS.filter((g) => g.count > 0)).toHaveLength(4);
  });

  it('demo commands record and update the model like the game would', async () => {
    const clock = fakeClock(0);
    const m = demo('landFactory');
    applyStripDemo(m, { active: null, idle: 0 });
    const rec = createRecordingCommands();
    const c = createCardDemoCommands(m, rec.commands);
    c.cardActivate('KeyQ', { shift: true, ctrl: false, alt: false, button: 0 });
    expect(m.card.queueCounts.value['core:lnd_t1_tank']).toBe(10);
    expect(m.card.flashSlot.value).toBe('KeyQ');
    await clock.advance(150);
    expect(m.card.flashSlot.value).toBeNull();
    c.cardActivate('KeyW', { shift: false, ctrl: false, alt: false, button: 2 });
    expect(m.card.queueCounts.value['core:lnd_t1_arty']).toBe(1);
    c.activateOrder('pause', { shift: false, ctrl: false, alt: false, button: 0 });
    expect(m.orders.states.value.pause?.toggle).toBe('on');
    c.activateOrder('selfDestruct', { shift: false, ctrl: false, alt: false, button: 0 });
    expect(m.orders.selfDestructCountdown.value).toBe(5);
    c.activateOrder('selfDestruct', { shift: false, ctrl: false, alt: false, button: 0 });
    expect(m.orders.selfDestructCountdown.value).toBeNull();
    c.recallGroup(0, { shift: false, ctrl: false, alt: false });
    expect(m.strip.activeGroup.value).toBe(0);
    c.saveGroup(5, false);
    expect(m.strip.groups.value[5]).toEqual({ count: 1, iconTypeId: 'core:str_t1_fac_land' });
    applyCardDemo(m, 'vogt');
    c.cardActivate('KeyW', { shift: false, ctrl: false, alt: false, button: 0 });
    expect(m.card.armedSlot.value).toBe('KeyW');
    expect(m.card.placingTypeId.value).toBe('core:str_t1_pgen');
    c.setTab(1);
    expect(m.card.tab.value).toBe(1);
    c.activateOrder('reclaim', { shift: false, ctrl: false, alt: false, button: 0 });
    expect(m.orders.states.value.reclaim?.armed).toBe(true);
    c.cancelMode();
    expect(m.card.armedSlot.value).toBeNull();
    expect(m.orders.states.value.reclaim?.armed).toBe(false);
    expect(rec.log.map((l) => l.name)).toContain('saveGroup');
  });

  it('hotbuild cycle: Q twice with a Meister → T3 then T2 mex, the tech tab follows, the placement stays armed', async () => {
    const m = createHudModel({ units: CAT });
    m.card.selectedTypes.value = ['core:lnd_t3_engineer'];
    m.card.unitCount.value = 1;
    const rec = createRecordingCommands();
    const commands = createCardDemoCommands(m, rec.commands);
    const { container } = renderWithHud(<CommandCard />, { model: m, commands });
    const opts = { mac: false, strip: true };
    const press = async (): Promise<void> => {
      await flushSignals(() => {
        handleHotkey(keyEvent('KeyQ').e, m, commands, opts);
      });
    };
    const cellQ = (): Element => container.querySelector('[data-slot="KeyQ"]')!;
    await press();
    expect(m.card.armedSlot.value).toBe('KeyQ');
    expect(m.card.placingTypeId.value).toBe('core:str_t3_mex');
    expect(cardSpec(m).value.tab).toBe(3);
    await press();
    expect(m.card.armedSlot.value).toBe('KeyQ');
    expect(m.card.placingTypeId.value).toBe('core:str_t2_mex');
    expect(m.card.tab.value).toBe(2);
    expect(cardSpec(m).value.cells[0]!.typeId).toBe('core:str_t2_mex');
    expect(cellQ().classList.contains('is-active')).toBe(true);
    await press();
    expect(m.card.placingTypeId.value).toBe('core:str_t1_mex');
    await press();
    expect(m.card.placingTypeId.value).toBe('core:str_t3_mex'); // wraps to the highest tier
    expect(m.card.tab.value).toBe(3);
    // Only Esc (cancelMode) or a right click on the armed cell end the placement.
    commands.cardActivate('KeyQ', { shift: false, ctrl: false, alt: false, button: 2 });
    expect(m.card.armedSlot.value).toBeNull();
    expect(m.card.placingTypeId.value).toBeNull();
    expect(rec.log.filter((c) => c.name === 'cardActivate')).toHaveLength(5);
  });
});
