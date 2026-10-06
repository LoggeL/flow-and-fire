import { describe, expect, it } from 'vitest';
import { resolveCardPage } from '../../src/data/card-logic.ts';
import { ARMY_ORDERS, BUILDER_ORDERS, CARD_DEMOS } from '../../src/demo/card.ts';
import { cellActionable, cellViews, tierStripes } from '../../src/hud/card/cells.ts';
import { cardHeadText, cellText, lockText, orderKeysText, orderShort } from '../../src/hud/card/labels.ts';
import { t } from '../../src/i18n/t.ts';
import { DE_MESSAGES, EN_MESSAGES } from '../../src/i18n/tables.ts';
import {
  ORDER_BAR_GROUPS,
  ORDER_DEFS,
  ORDER_TEXT,
  abilityOfToggle,
  orderStatesKey,
} from '../../src/model/orders.ts';
import { SLOT_CODES } from '../../src/ui/keys.ts';
import { demoUnitCatalog } from '../../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

/** ui.md §5.8 table: key, order, symbol, behaviour, feature id. */
const TABLE = [
  ['KeyQ', 'move', 'move', 'armed', 'C4', 'Bewegen'],
  ['KeyW', 'patrol', 'patrol', 'armed', 'C12', 'Patrouille'],
  ['KeyE', 'assist', 'assist', 'armed', 'B2', 'Assist'],
  ['KeyR', 'reclaim', 'reclaim', 'armed', 'E7', 'Reclaim'],
  ['KeyT', 'repair', 'repair', 'armed', 'G4', 'Reparieren'],
  ['KeyA', 'attack', 'attackmove', 'armed', 'C6', 'Angriff'],
  ['KeyS', 'stop', 'stop', 'instant', 'S3', 'Stop'],
  ['KeyD', 'pause', 'pause', 'toggle', 'E13', 'Pause'],
  ['KeyF', 'fireState', 'fire_free', 'cycle', 'K6', 'Feuer'],
  ['KeyG', 'ability', 'shield', 'toggle', 'C17', 'Fähigkeit'],
  ['KeyZ', 'attackGround', 'attackground', 'armed', 'K6', 'Boden'],
  ['KeyX', 'tapshot', 'tapshot', 'armed', 'U8', 'Abstich'],
  ['KeyC', 'formation', 'formation', 'armed', 'C13', 'Formation'],
  ['KeyB', 'selfDestruct', 'selfdestruct', 'countdown', 'C18', 'Sprengen'],
] as const;

describe('ORDER_DEFS against ui.md §5.8', () => {
  it.each(TABLE)('%s → %s', (slot, id, icon, behavior, feature, short) => {
    const d = ORDER_DEFS.find((o) => o.id === id);
    expect(d).toBeDefined();
    expect(d?.slot).toBe(slot);
    expect(d?.icon).toBe(icon);
    expect(d?.behavior).toBe(behavior);
    expect(d?.features[0]).toBe(feature);
    expect(t(ORDER_TEXT[id].short, undefined, 'de')).toBe(short);
  });

  it('self-destruct has no grid key (R4); every other order uses its own slot as key', () => {
    for (const d of ORDER_DEFS) expect(d.key).toBe(d.id === 'selfDestruct' ? null : d.slot);
  });

  it('short labels are ≤ 10 characters in DE and EN (58-px cell), pseudo keeps them unpadded', () => {
    for (const d of ORDER_DEFS) {
      const k = ORDER_TEXT[d.id].short;
      expect(DE_MESSAGES[k]?.length, k).toBeLessThanOrEqual(10);
      expect(EN_MESSAGES[k]?.length, k).toBeLessThanOrEqual(10);
      expect(orderShort(d.id, 'pseudo').length, k).toBeLessThanOrEqual(10);
    }
    expect(orderShort('patrol', 'pseudo')).toBe('Þáţŕóúíľľé');
    expect(cellText('ui.card.cell.upgrade', 'pseudo')).toBe('Úþĝŕáďé');
  });

  it('order bar groups follow the grid order and hold every order once', () => {
    expect(ORDER_BAR_GROUPS.flat()).toEqual(ORDER_DEFS.map((d) => d.id));
  });

  it('abilityOfToggle maps roster toggles', () => {
    expect(abilityOfToggle('auto_tapshot')).toBe('autoTapshot');
    expect(abilityOfToggle('radar')).toBe('radar');
    expect(abilityOfToggle('shield')).toBe('shield');
    expect(abilityOfToggle('cloak')).toBeNull();
  });

  it('orderStatesKey ignores object identity and changes with visible state', () => {
    expect(orderStatesKey({ ...BUILDER_ORDERS })).toBe(orderStatesKey(BUILDER_ORDERS));
    expect(orderStatesKey({ ...BUILDER_ORDERS, move: { enabled: true, armed: true } })).not.toBe(orderStatesKey(BUILDER_ORDERS));
  });
});

describe('labels', () => {
  it('card heads per page', () => {
    expect(cardHeadText(CAT, resolveCardPage(CAT, ['core:cmd_commander']), 1, 'de')).toBe('Bau · Vogt');
    expect(cardHeadText(CAT, resolveCardPage(CAT, ['core:str_t1_fac_land']), 1, 'de')).toBe('Produktion · Landwerk I');
    expect(cardHeadText(CAT, resolveCardPage(CAT, ['core:str_t1_mex']), 1, 'de')).toBe('Gebäude · Zapfstelle I');
    expect(cardHeadText(CAT, resolveCardPage(CAT, ['core:lnd_t1_tank']), 1, 'de')).toBe('Befehle · 1 Einheit');
    expect(cardHeadText(CAT, resolveCardPage(CAT, ['core:lnd_t1_tank']), 19, 'en')).toBe('Orders · 19 units');
    expect(cardHeadText(CAT, resolveCardPage(CAT, []), 0, 'de')).toBe('Command Card');
  });

  it('lock texts (ui.md §5.6)', () => {
    expect(lockText(CAT, { reason: 'needFactoryUpgrade', tier: 2 }, 'core:str_t1_fac_land', 'de')).toBe('ab T2: Landwerk freisprechen');
    expect(lockText(CAT, { reason: 'needBuilderTech', tier: 2 }, 'core:cmd_commander', 'de')).toBe('ab T2: Geselle (T2-Engineer)');
    expect(lockText(CAT, { reason: 'needBuilderTech', tier: 3 }, 'core:lnd_t2_engineer', 'en')).toBe('from T3: Master (T3 engineer)');
  });

  it('order key hints: Alt on build pages, plain on the orders page, Alt+⇧ in the WASD scheme', () => {
    expect(orderKeysText('attackGround', 'build', 'de', {}, 'de')).toBe('Alt+Y');
    expect(orderKeysText('attackGround', 'orders', 'en', {}, 'de')).toBe('Taste Z');
    expect(orderKeysText('stop', 'production', 'de', { scheme: 'wasd' }, 'de')).toBe('Alt+⇧+S');
    expect(orderKeysText('selfDestruct', 'orders', 'de', { mac: true }, 'de')).toBe('Strg+Entf / Strg+⌫');
  });
});

describe('cellViews', () => {
  it('stripes: on / in / out / none, hidden with fewer than two tiers', () => {
    expect(tierStripes({ roleTiers: [1, 2, 3], tiers: [1, 2, 3], shownTier: 2 })).toEqual(['in', 'on', 'in']);
    expect(tierStripes({ roleTiers: [1, 2, 3], tiers: [1], shownTier: 1 })).toEqual(['on', 'out', 'out']);
    expect(tierStripes({ roleTiers: [2, 3], tiers: [], shownTier: 2 })).toEqual(['none', 'on', 'out']);
    expect(tierStripes({ roleTiers: [2], tiers: [], shownTier: 2 })).toBeNull();
  });

  it('orders page: 14 order cells + V empty, self-destruct shows the Delete key', () => {
    const views = cellViews(resolveCardPage(CAT, CARD_DEMOS.army.selected), { ...emptyInputs(), orderStates: ARMY_ORDERS });
    expect(views.filter((v) => v.kind === 'order')).toHaveLength(14);
    expect(views[SLOT_CODES.indexOf('KeyV')]?.kind).toBe('empty');
    const b = views[SLOT_CODES.indexOf('KeyB')]!;
    expect(b.keyCode).toBe('Delete');
    expect(b.danger).toBe(true);
    expect(views[SLOT_CODES.indexOf('KeyA')]?.active).toBe(true);
    expect(views[SLOT_CODES.indexOf('KeyR')]?.disabled).toBe('noEngineer');
  });

  it('cap reached disables unit cells on build/production pages but not the upgrade', () => {
    const views = cellViews(resolveCardPage(CAT, ['core:str_t1_fac_land']), { ...emptyInputs(), capReached: true });
    expect(views[0]?.disabled).toBe('cap');
    expect(cellActionable(views[0]!)).toBe(false);
    const b = views[SLOT_CODES.indexOf('KeyB')]!;
    expect(b.kind).toBe('upgrade');
    expect(cellActionable(b)).toBe(true);
  });

  it('queue badge replaces the stripes; progress only on production pages', () => {
    const views = cellViews(resolveCardPage(CAT, ['core:str_t1_fac_land']), { ...emptyInputs(), queueCounts: { 'core:lnd_t1_arty': 2 } });
    const w = views[SLOT_CODES.indexOf('KeyW')]!;
    expect(w.badge).toBe(2);
    expect(w.stripes).toBeNull();
    expect(w.progress).toBe(true);
    const build = cellViews(resolveCardPage(CAT, ['core:cmd_commander']), { ...emptyInputs(), queueCounts: { 'core:str_t1_pgen': 1 } });
    expect(build[1]?.progress).toBe(false);
  });
});

function emptyInputs(): Parameters<typeof cellViews>[1] & object {
  return { queueCounts: {}, armedSlot: null, capReached: false, orderStates: {}, countdown: null };
}
