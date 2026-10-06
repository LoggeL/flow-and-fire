// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { getUnit } from '../../src/data/roster.ts';
import { applyCardDemo } from '../../src/demo/card.ts';
import { CommandCard } from '../../src/hud/card/CommandCard.tsx';
import { gridNavIndex } from '../../src/hud/card/CommandCard.tsx';
import { createHudModel } from '../../src/model/index.ts';
import type { HudModel } from '../../src/model/index.ts';
import { SLOT_CODES } from '../../src/ui/keys.ts';
import type { SlotCode } from '../../src/ui/keys.ts';
import { fireEvent, flushSignals, lastCall, renderWithHud } from '../support/index.tsx';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

function modelWith(selected: readonly string[], unitCount = selected.length): HudModel {
  const m = createHudModel({ units: CAT });
  m.card.selectedTypes.value = selected;
  m.card.unitCount.value = unitCount;
  return m;
}

function cell(root: ParentNode, slot: SlotCode): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (el === null) throw new Error(`no cell ${slot}`);
  return el;
}

function names(root: ParentNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of SLOT_CODES) {
    const n = cell(root, slot).querySelector('.ff-cell__name');
    if (n !== null) out[slot.slice(3)] = n.textContent ?? '';
  }
  return out;
}

/** Stripe states per cell: 'on', 'in', 'out' (plain stripe, no class), 'none'. */
function stripes(root: ParentNode, slot: SlotCode): string[] | null {
  const tiers = cell(root, slot).querySelector('.ff-cell__tiers');
  if (tiers === null) return null;
  return Array.from(tiers.querySelectorAll('i')).map((i) => i.getAttribute('class') ?? 'out');
}

function keysOf(root: ParentNode): string[] {
  return SLOT_CODES.map((s) => cell(root, s).querySelector('.ff-cell__key')?.textContent ?? '');
}

describe('CommandCard content against ui.md §5.6', () => {
  it('Vogt: head „Bau · Vogt“, build grid from roster.json, T1 preselected, T2/T3 locked', () => {
    const { container } = renderWithHud(<CommandCard mac={false} />, { model: modelWith(['core:cmd_commander']) });
    expect(container.querySelector('[data-testid="card-head"]')?.textContent).toBe('Bau · Vogt');
    expect(names(container)).toEqual({
      Q: 'Zapfstelle',
      W: 'Glutkessel',
      E: 'Dampfqu.',
      R: 'Erzsp.',
      T: 'Glutsp.',
      A: 'Landwerk',
      S: 'Luftwerk',
      D: 'Horcher',
      F: 'Schirm',
      Z: 'Riegel',
      X: 'Rost',
      C: 'Mauer',
      V: 'Tiegel',
    });
    // G (Großguss, post-MVP) and B stay empty.
    expect(cell(container, 'KeyG').classList.contains('is-empty')).toBe(true);
    expect(cell(container, 'KeyB').classList.contains('is-empty')).toBe(true);
    // Key labels follow the German layout: bottom row Y X C V B.
    expect(keysOf(container)).toEqual(['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Y', 'X', 'C', 'V', 'B']);
    // Locks: F Schirm and V Tiegel need a Geselle (T2 engineer); name stays readable, lock icon left.
    for (const slot of ['KeyF', 'KeyV'] as const) {
      const c = cell(container, slot);
      expect(c.classList.contains('is-locked')).toBe(true);
      expect(c.querySelector('.ff-cell__lock')).not.toBeNull();
      expect(c.getAttribute('aria-label')).toContain('ab T2: Geselle (T2-Engineer)');
    }
    expect(cell(container, 'KeyQ').classList.contains('is-locked')).toBe(false);
    // Stripes: Q Zapfstelle I–III with I on, II/III not directly buildable by the Reeve.
    expect(stripes(container, 'KeyQ')).toEqual(['on', 'out', 'out']);
    // E Dampfquelle has only one tier → no stripes; Z Riegel I–II; V Tiegel II–III (II shown, locked).
    expect(stripes(container, 'KeyE')).toBeNull();
    expect(stripes(container, 'KeyZ')).toEqual(['on', 'out', 'none']);
    expect(stripes(container, 'KeyV')).toEqual(['none', 'on', 'out']);
    // Tabs.
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-disabled')).toBe('true');
    expect(tabs[2]?.getAttribute('aria-disabled')).toBe('true');
    expect(tabs[1]?.getAttribute('title')).toContain('Geselle');
  });

  it('Landwerk I: head, production grid, queue badges replace stripes, B = Upgrade, locks name the factory', async () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'landFactory');
    const { container } = renderWithHud(<CommandCard />, { model: m });
    expect(container.querySelector('[data-testid="card-head"]')?.textContent).toBe('Produktion · Landwerk I');
    expect(names(container)).toEqual({
      Q: 'Punze',
      W: 'Kelle',
      E: 'Lehrling',
      R: 'Sieb',
      A: 'Funke',
      S: 'Stichel',
      D: 'Schürze',
      F: 'Reißnadel',
      B: 'Upgrade',
    });
    expect(cell(container, 'KeyQ').querySelector('.ff-cell__badge')?.textContent).toBe('5');
    expect(cell(container, 'KeyQ').querySelector('.ff-cell__tiers')).toBeNull();
    expect(cell(container, 'KeyW').querySelector('.ff-cell__badge')?.textContent).toBe('2');
    // S (bots, not queued) keeps its stripes: 1–3 with I shown.
    expect(stripes(container, 'KeyS')).toEqual(['on', 'out', 'out']);
    expect(cell(container, 'KeyD').getAttribute('aria-label')).toContain('ab T2: Landwerk freisprechen');
    expect(cell(container, 'KeyF').getAttribute('aria-label')).toContain('ab T3: Landwerk freisprechen');
    expect(cell(container, 'KeyB').getAttribute('data-kind')).toBe('upgrade');
    expect(cell(container, 'KeyB').getAttribute('aria-label')).toBe('Upgrade: Landwerk II (B)');
    // Progress stripe of the running tank at 64 %, updated at 10 Hz without re-rendering.
    const bar = cell(container, 'KeyQ').querySelector<HTMLElement>('.ff-cell__prog > i');
    expect(bar?.style.getPropertyValue('--p')).toBe('0.64');
    const before = cell(container, 'KeyQ');
    await flushSignals(() => {
      m.card.progress.value = { 'core:lnd_t1_tank': 0.8 };
    });
    expect(bar?.style.getPropertyValue('--p')).toBe('0.8');
    expect(cell(container, 'KeyQ')).toBe(before);
  });

  it('Luftwerk I: Q/W/A T1 only, E/R T2 locked, two tabs', () => {
    const { container } = renderWithHud(<CommandCard />, { model: modelWith(['core:str_t1_fac_air']) });
    expect(container.querySelector('[data-testid="card-head"]')?.textContent).toBe('Produktion · Luftwerk I');
    expect(Object.keys(names(container))).toEqual(['Q', 'W', 'E', 'R', 'A', 'B']);
    expect(cell(container, 'KeyE').classList.contains('is-locked')).toBe(true);
    expect(cell(container, 'KeyR').classList.contains('is-locked')).toBe(true);
    expect(cell(container, 'KeyQ').querySelector('.ff-cell__tiers')).toBeNull();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
  });

  it('structure page (Zapfstelle I): head, B Upgrade, D Pause, no tabs', () => {
    const { container } = renderWithHud(<CommandCard />, { model: modelWith(['core:str_t1_mex']) });
    expect(container.querySelector('[data-testid="card-head"]')?.textContent).toBe('Gebäude · Zapfstelle I');
    expect(cell(container, 'KeyB').getAttribute('data-kind')).toBe('upgrade');
    expect(cell(container, 'KeyD').getAttribute('data-kind')).toBe('pause');
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it('structure page (Horcher I): G = ability (radar)', () => {
    const { container } = renderWithHud(<CommandCard />, { model: modelWith(['core:str_t1_radar']) });
    expect(cell(container, 'KeyG').getAttribute('data-kind')).toBe('ability');
    expect(cell(container, 'KeyG').querySelector('.ff-cell__name')?.textContent).toBe('Radar');
  });

  it('orders page: head „Befehle · 19 Einheiten“, order grid without Alt, self-destruct shows „Entf“', () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'army');
    const { container } = renderWithHud(<CommandCard mac={false} />, { model: m });
    expect(container.querySelector('[data-testid="card-head"]')?.textContent).toBe('Befehle · 19 Einheiten');
    expect(container.querySelector('[data-testid="card-fire-state"]')?.textContent).toBe('Feuermodus: Feuer frei');
    expect(names(container)).toEqual({
      Q: 'Bewegen',
      W: 'Patrouille',
      E: 'Assist',
      R: 'Reclaim',
      T: 'Reparieren',
      A: 'Angriff',
      S: 'Stop',
      D: 'Pause',
      F: 'Feuer',
      G: 'Fähigkeit',
      Z: 'Boden',
      X: 'Abstich',
      C: 'Formation',
      B: 'Sprengen',
    });
    expect(cell(container, 'KeyB').querySelector('.ff-cell__key')?.textContent).toBe('Entf');
    expect(cell(container, 'KeyB').classList.contains('ff-cell--danger')).toBe(true);
    expect(cell(container, 'KeyA').classList.contains('is-active')).toBe(true); // armed attack
    expect(cell(container, 'KeyR').classList.contains('is-disabled')).toBe(true);
    expect(cell(container, 'KeyZ').querySelector('.ff-cell__badge')?.textContent).toBe('3');
    expect(cell(container, 'KeyF').querySelectorAll('.ff-cell__dots i')).toHaveLength(3);
    expect(cell(container, 'KeyV').classList.contains('is-empty')).toBe(true);
    expect(container.querySelector('[role="grid"]')?.getAttribute('aria-label')).toBe('Befehlsraster');
  });

  it('empty selection: head „Command Card“, 15 empty cells', () => {
    const { container } = renderWithHud(<CommandCard />);
    expect(container.querySelector('[data-testid="card-head"]')?.textContent).toBe('Command Card');
    expect(container.querySelectorAll('.ff-cell.is-empty')).toHaveLength(15);
  });

  it('English layout labels the bottom row Z X C V B', () => {
    const m = modelWith(['core:cmd_commander']);
    m.keyboardLayout.value = 'en';
    const { container } = renderWithHud(<CommandCard />, { model: m, locale: 'en' });
    expect(keysOf(container).slice(10)).toEqual(['Z', 'X', 'C', 'V', 'B']);
    expect(container.querySelector('[data-testid="card-head"]')?.textContent).toBe('Build · Reeve');
  });
});

describe('tech tabs', () => {
  it('switching tabs changes tiers only, never positions (T3 engineer)', async () => {
    const m = modelWith(['core:lnd_t3_engineer']);
    const { container } = renderWithHud(<CommandCard />, { model: m });
    const read = (): { units: (string | null)[]; kinds: (string | null)[] } => ({
      units: SLOT_CODES.map((s) => cell(container, s).getAttribute('data-unit')),
      kinds: SLOT_CODES.map((s) => cell(container, s).getAttribute('data-kind')),
    });
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('T3');
    const t3 = read();
    for (const tier of [1, 2] as const) {
      await flushSignals(() => {
        m.card.tab.value = tier;
      });
      const now = read();
      expect(now.kinds).toEqual(t3.kinds);
      // Same slots filled with the same roles, only the tier inside the id changes.
      expect(now.units.map((u) => u === null)).toEqual(t3.units.map((u) => u === null));
      SLOT_CODES.forEach((slot, i) => {
        const u = now.units[i];
        if (u !== null && u !== undefined) expect(getUnit(CAT, u).hotbuild?.slot, `${slot} T${tier}`).toBe(slot.slice(3));
      });
      expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(`T${tier}`);
    }
    expect(cell(container, 'KeyQ').getAttribute('data-unit')).toBe('core:str_t2_mex');
    expect(cell(container, 'KeyE').getAttribute('data-unit')).toBe('core:str_t1_hydro'); // no T2 variant → lower tier, no gap
  });

  it('tab click calls setTab; locked tabs do not', () => {
    const { container, log } = renderWithHud(<CommandCard />, { model: modelWith(['core:lnd_t2_engineer']) });
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    fireEvent.click(tabs[0]!);
    expect(lastCall(log, 'setTab')?.args).toEqual([1]);
    const n = log.length;
    fireEvent.click(tabs[2]!); // T3 locked for a Geselle
    expect(log.length).toBe(n);
  });
});

describe('clicks → commands', () => {
  it('plain, Shift, Ctrl and right clicks pass their modifiers to cardActivate', () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'landFactory');
    const { container, log } = renderWithHud(<CommandCard />, { model: m });
    const q = cell(container, 'KeyQ');
    fireEvent.click(q);
    expect(lastCall(log, 'cardActivate')?.args).toEqual(['KeyQ', { shift: false, ctrl: false, alt: false, button: 0 }]);
    fireEvent.click(q, { shiftKey: true });
    expect(lastCall(log, 'cardActivate')?.args).toEqual(['KeyQ', { shift: true, ctrl: false, alt: false, button: 0 }]);
    fireEvent.click(q, { ctrlKey: true });
    expect(lastCall(log, 'cardActivate')?.args).toEqual(['KeyQ', { shift: false, ctrl: true, alt: false, button: 0 }]);
    fireEvent.click(q, { metaKey: true });
    expect(lastCall(log, 'cardActivate')?.args).toEqual(['KeyQ', { shift: false, ctrl: true, alt: false, button: 0 }]);
    fireEvent.contextMenu(q, { button: 2 });
    expect(lastCall(log, 'cardActivate')?.args).toEqual(['KeyQ', { shift: false, ctrl: false, alt: false, button: 2 }]);
    fireEvent.contextMenu(q, { button: 2, shiftKey: true });
    expect(lastCall(log, 'cardActivate')?.args).toEqual(['KeyQ', { shift: true, ctrl: false, alt: false, button: 2 }]);
    // Clicks on children of the cell (icon, name) resolve to the cell.
    fireEvent.click(cell(container, 'KeyW').querySelector('.ff-cell__name')!);
    expect(lastCall(log, 'cardActivate')?.args[0]).toBe('KeyW');
  });

  it('locked, empty and cap-disabled cells issue nothing', async () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'landFactory');
    const { container, log } = renderWithHud(<CommandCard />, { model: m });
    fireEvent.click(cell(container, 'KeyD')); // locked
    fireEvent.click(cell(container, 'KeyT')); // empty
    expect(log.filter((c) => c.name === 'cardActivate')).toHaveLength(0);
    await flushSignals(() => {
      m.card.capReached.value = true;
    });
    expect(cell(container, 'KeyQ').classList.contains('is-disabled')).toBe(true);
    expect(cell(container, 'KeyQ').getAttribute('aria-label')).toContain('Unit-Cap erreicht');
    fireEvent.click(cell(container, 'KeyQ'));
    expect(log.filter((c) => c.name === 'cardActivate')).toHaveLength(0);
    fireEvent.click(cell(container, 'KeyB')); // upgrade is not a new unit
    expect(lastCall(log, 'cardActivate')?.args[0]).toBe('KeyB');
  });

  it('orders page: cells call activateOrder; disabled ones do not; self-destruct only by click', () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'army');
    const { container, log } = renderWithHud(<CommandCard />, { model: m });
    fireEvent.click(cell(container, 'KeyS'), { shiftKey: true });
    expect(lastCall(log, 'activateOrder')?.args).toEqual(['stop', { shift: true, ctrl: false, alt: false, button: 0 }]);
    fireEvent.click(cell(container, 'KeyR'));
    expect(lastCall(log, 'activateOrder')?.args[0]).toBe('stop');
    fireEvent.click(cell(container, 'KeyB'));
    expect(lastCall(log, 'activateOrder')?.args[0]).toBe('selfDestruct');
    expect(log.filter((c) => c.name === 'cardActivate')).toHaveLength(0);
  });

  it('self-destruct countdown: seconds replace the key, a click aborts', async () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'selfDestruct');
    const { container, log } = renderWithHud(<CommandCard />, { model: m });
    const b = cell(container, 'KeyB');
    expect(b.classList.contains('is-countdown')).toBe(true);
    expect(b.querySelector('.ff-cell__key')?.textContent).toBe('3');
    await flushSignals(() => {
      m.orders.selfDestructCountdown.value = 2;
    });
    expect(cell(container, 'KeyB').querySelector('.ff-cell__key')?.textContent).toBe('2');
    fireEvent.click(cell(container, 'KeyB'));
    expect(lastCall(log, 'activateOrder')?.args[0]).toBe('selfDestruct');
  });

  it('placement: armed slot is active, flash marks the cell', async () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'placement');
    const { container } = renderWithHud(<CommandCard />, { model: m });
    expect(cell(container, 'KeyW').classList.contains('is-active')).toBe(true);
    await flushSignals(() => {
      m.card.flashSlot.value = 'KeyQ';
    });
    expect(cell(container, 'KeyQ').classList.contains('is-flash')).toBe(true);
  });
});

describe('tooltip targets', () => {
  it('hovering a build cell names the unit with the builder BP; leaving clears it', () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'vogt');
    const { container } = renderWithHud(<CommandCard />, { model: m });
    fireEvent.pointerOver(cell(container, 'KeyW').querySelector('.ff-cell__name')!);
    expect(m.tooltip.target.value).toEqual({
      kind: 'unit',
      typeId: 'core:str_t1_pgen',
      slot: 'KeyW',
      builderBp: 10,
      mode: 'build',
      locked: null,
      disabledReason: undefined,
    });
    fireEvent.pointerLeave(container.querySelector('[role="grid"]')!);
    expect(m.tooltip.target.value).toBeNull();
  });

  it('factory cells use the reported assist BP and factory mode; order cells name the order', () => {
    const m = createHudModel({ units: CAT });
    applyCardDemo(m, 'landFactory');
    const { container, unmount } = renderWithHud(<CommandCard />, { model: m });
    fireEvent.pointerOver(cell(container, 'KeyQ'));
    expect(m.tooltip.target.value).toMatchObject({ kind: 'unit', builderBp: 35, mode: 'factory' });
    unmount();
    const a = createHudModel({ units: CAT });
    applyCardDemo(a, 'army');
    const r = renderWithHud(<CommandCard />, { model: a });
    fireEvent.focusIn(cell(r.container, 'KeyS'));
    expect(a.tooltip.target.value).toEqual({ kind: 'order', orderId: 'stop' });
    expect(a.tooltip.viaKeyboard.value).toBe(true);
  });
});

describe('accessibility: role="grid" with arrow navigation', () => {
  it('rows and cells, one tab stop, arrows move focus, labels contain the key', () => {
    const { container } = renderWithHud(<CommandCard />, { model: modelWith(['core:cmd_commander']) });
    const grid = container.querySelector<HTMLElement>('[role="grid"]')!;
    expect(grid.getAttribute('aria-label')).toBe('Bau-Raster');
    expect(grid.querySelectorAll('[role="row"]')).toHaveLength(3);
    expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(15);
    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(cell(container, 'KeyQ').getAttribute('aria-label')).toBe('Zapfstelle I (Q)');
    expect(cell(container, 'KeyZ').getAttribute('aria-label')).toBe('Riegel I (Y)');
    const q = cell(container, 'KeyQ');
    q.focus();
    fireEvent.keyDown(q, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cell(container, 'KeyW'));
    fireEvent.keyDown(cell(container, 'KeyW'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cell(container, 'KeyS'));
    fireEvent.keyDown(cell(container, 'KeyS'), { key: 'End' });
    expect(document.activeElement).toBe(cell(container, 'KeyG'));
    expect(cell(container, 'KeyG').getAttribute('tabindex')).toBe('0');
    expect(cell(container, 'KeyQ').getAttribute('tabindex')).toBe('-1');
  });

  it('gridNavIndex stays inside the 5 × 3 grid', () => {
    expect(gridNavIndex(0, 'ArrowLeft')).toBe(0);
    expect(gridNavIndex(0, 'ArrowUp')).toBe(0);
    expect(gridNavIndex(4, 'ArrowRight')).toBe(4);
    expect(gridNavIndex(14, 'ArrowDown')).toBe(14);
    expect(gridNavIndex(7, 'Home')).toBe(5);
    expect(gridNavIndex(7, 'End')).toBe(9);
    expect(gridNavIndex(7, 'ArrowUp')).toBe(2);
  });
});
