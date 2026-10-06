/**
 * Deterministic demo data of the command card, order bar and strip (hud-p4): fixed selections and
 * states as in the mockup (docs/design/ui-mockups/hud.html?sel=vogt|factory|army), plus interactive demo
 * commands for the gallery that write the model like the game would (the game itself never lets the
 * HUD change state, ui.md §7.6). No randomness needed; nothing here reads the clock.
 */
import { batch } from '@preact/signals';
import type { HudCommands } from '../commands/index.ts';
import { nextHotbuildTier, resolveCardPage } from '../data/card-logic.ts';
import { findUnit } from '../data/roster.ts';
import { CELL_FLASH_MS, isTechTier } from '../model/card.ts';
import type { TechTier } from '../model/card.ts';
import type { HudModel } from '../model/index.ts';
import { FIRE_STATES, SELF_DESTRUCT_SECONDS, orderDef } from '../model/orders.ts';
import type { OrderId, OrderState, OrderStates } from '../model/orders.ts';
import { groupsFrom } from '../model/strip.ts';
import type { ControlGroupData } from '../model/strip.ts';
import type { SlotCode } from '../ui/keys.ts';

export type CardDemoId =
  | 'empty'
  | 'vogt'
  | 'engineerT2'
  | 'engineerT3'
  | 'mixedBuilders'
  | 'landFactory'
  | 'airFactory'
  | 'mex'
  | 'radar'
  | 'army'
  | 'capReached'
  | 'placement'
  | 'selfDestruct';

export interface CardDemo {
  /** Selected type ids (distinct, selection order). */
  readonly selected: readonly string[];
  readonly unitCount: number;
  readonly tab?: TechTier | null;
  readonly queueCounts?: Readonly<Record<string, number>>;
  readonly progress?: Readonly<Record<string, number>>;
  readonly armedSlot?: SlotCode | null;
  readonly placingTypeId?: string | null;
  readonly capReached?: boolean;
  readonly buildPower?: number | null;
  readonly orders: OrderStates;
  readonly countdown?: number | null;
}

const off = (reason: NonNullable<OrderState['reason']>): OrderState => ({ enabled: false, reason });
const ON: OrderState = { enabled: true };

/** Orders of a Reeve / engineer selection (build page, order bar visible). */
export const BUILDER_ORDERS: OrderStates = {
  move: ON,
  patrol: ON,
  assist: ON,
  reclaim: ON,
  repair: ON,
  attack: ON,
  stop: ON,
  pause: off('nothingToPause'),
  fireState: { enabled: true, cycle: 0 },
  ability: { enabled: true, toggle: 'on', ability: 'autoTapshot' },
  attackGround: off('noArtillery'),
  tapshot: ON,
  formation: off('noFormation'),
  selfDestruct: ON,
};

/** Orders of engineers without the Reeve (no tap shot, no ability). */
export const ENGINEER_ORDERS: OrderStates = {
  ...BUILDER_ORDERS,
  fireState: off('noWeapon'),
  ability: off('noAbility'),
  tapshot: off('noCommander'),
  attack: off('noWeapon'),
};

/** Orders of a factory selection (production page): only stop, pause, self-destruct. */
export const FACTORY_ORDERS: OrderStates = {
  move: off('immobile'),
  patrol: off('immobile'),
  assist: off('factoryOnly'),
  reclaim: off('noEngineer'),
  repair: off('noEngineer'),
  attack: off('noWeapon'),
  stop: ON,
  pause: { enabled: true, toggle: 'off' },
  fireState: off('noWeapon'),
  ability: off('noAbility'),
  attackGround: off('noArtillery'),
  tapshot: off('noCommander'),
  formation: off('immobile'),
  selfDestruct: ON,
};

/** Orders of an upgradeable structure (mex): pause, stop and self-destruct. */
export const STRUCTURE_ORDERS: OrderStates = {
  ...FACTORY_ORDERS,
  assist: off('immobile'),
};

/** Orders of a combat selection (orders page) with armed attack and three artillery units. */
export const ARMY_ORDERS: OrderStates = {
  move: ON,
  patrol: ON,
  assist: ON,
  reclaim: off('noEngineer'),
  repair: off('noEngineer'),
  attack: { enabled: true, armed: true },
  stop: ON,
  pause: off('nothingToPause'),
  fireState: { enabled: true, cycle: 0 },
  ability: off('noAbility'),
  attackGround: { enabled: true, badge: 3 },
  tapshot: off('noCommander'),
  formation: ON,
  selfDestruct: ON,
};

const VOGT = 'core:cmd_commander';
const LAND1 = 'core:str_t1_fac_land';

export const CARD_DEMOS: Readonly<Record<CardDemoId, CardDemo>> = {
  empty: { selected: [], unitCount: 0, orders: {} },
  vogt: { selected: [VOGT], unitCount: 1, orders: BUILDER_ORDERS },
  engineerT2: { selected: ['core:lnd_t2_engineer'], unitCount: 2, orders: ENGINEER_ORDERS },
  engineerT3: { selected: ['core:lnd_t3_engineer'], unitCount: 1, orders: ENGINEER_ORDERS },
  mixedBuilders: {
    selected: ['core:lnd_t1_engineer', 'core:lnd_t2_engineer', 'core:lnd_t1_tank'],
    unitCount: 7,
    orders: { ...ENGINEER_ORDERS, attack: ON, fireState: { enabled: true, cycle: 1 } },
  },
  landFactory: {
    selected: [LAND1],
    unitCount: 1,
    queueCounts: { 'core:lnd_t1_tank': 5, 'core:lnd_t1_arty': 2, 'core:lnd_t1_engineer': 1, 'core:lnd_t1_aa': 1 },
    progress: { 'core:lnd_t1_tank': 0.64 },
    buildPower: 35,
    orders: FACTORY_ORDERS,
  },
  airFactory: {
    selected: ['core:str_t1_fac_air'],
    unitCount: 1,
    queueCounts: { 'core:air_t1_fighter': 2 },
    progress: { 'core:air_t1_fighter': 0.3 },
    orders: FACTORY_ORDERS,
  },
  mex: { selected: ['core:str_t1_mex'], unitCount: 1, orders: STRUCTURE_ORDERS },
  radar: {
    selected: ['core:str_t1_radar'],
    unitCount: 1,
    orders: { ...STRUCTURE_ORDERS, ability: { enabled: true, toggle: 'on', ability: 'radar' } },
  },
  army: {
    selected: ['core:lnd_t1_tank', 'core:lnd_t1_arty', 'core:lnd_t1_bot', 'core:lnd_t1_aa', 'core:lnd_t1_scout'],
    unitCount: 19,
    orders: ARMY_ORDERS,
  },
  capReached: {
    selected: [LAND1],
    unitCount: 1,
    queueCounts: { 'core:lnd_t1_tank': 2 },
    progress: { 'core:lnd_t1_tank': 0.2 },
    capReached: true,
    orders: FACTORY_ORDERS,
  },
  placement: {
    selected: [VOGT],
    unitCount: 1,
    armedSlot: 'KeyW',
    placingTypeId: 'core:str_t1_pgen',
    orders: BUILDER_ORDERS,
  },
  selfDestruct: {
    selected: ['core:lnd_t1_tank', 'core:lnd_t1_arty'],
    unitCount: 4,
    orders: { ...ARMY_ORDERS, attack: ON },
    countdown: 3,
  },
};

/** Control groups of the demo (mockup hud.js renderStrip): 1 tanks ×18, 2 artillery ×3, 3 land works, 4 engineers ×2. */
export const DEMO_GROUPS: readonly ControlGroupData[] = groupsFrom({
  0: { count: 18, iconTypeId: 'core:lnd_t1_tank' },
  1: { count: 3, iconTypeId: 'core:lnd_t1_arty' },
  2: { count: 1, iconTypeId: LAND1 },
  3: { count: 2, iconTypeId: 'core:lnd_t1_engineer' },
});

/** Writes a card demo into the model (one batch, like one selection event of the game). */
export function applyCardDemo(model: HudModel, id: CardDemoId): void {
  const d = CARD_DEMOS[id];
  batch(() => {
    const card = model.card;
    card.selectedTypes.value = d.selected;
    card.unitCount.value = d.unitCount;
    card.tab.value = d.tab ?? null;
    card.queueCounts.value = d.queueCounts ?? {};
    card.progress.value = d.progress ?? {};
    card.armedSlot.value = d.armedSlot ?? null;
    card.placingTypeId.value = d.placingTypeId ?? null;
    card.capReached.value = d.capReached ?? false;
    card.buildPower.value = d.buildPower ?? null;
    card.flashSlot.value = null;
    model.orders.states.value = d.orders;
    model.orders.selfDestructCountdown.value = d.countdown ?? null;
  });
}

/** Writes the strip demo: groups 1–4 filled, group `active` (0-based) active, idle counts. */
export function applyStripDemo(model: HudModel, opts: { readonly active?: number | null; readonly idle?: number; readonly idleFactories?: number } = {}): void {
  batch(() => {
    model.strip.groups.value = DEMO_GROUPS;
    model.strip.activeGroup.value = opts.active === undefined ? 1 : opts.active;
    model.strip.idleEngineers.value = opts.idle ?? 3;
    model.strip.idleFactories.value = opts.idleFactories ?? 1;
  });
}

function nextOrderStates(states: OrderStates, id: OrderId, countdownRunning: boolean): { states: OrderStates; countdown: 'start' | 'abort' | null } {
  const def = orderDef(id);
  const cur = states[id] ?? { enabled: true };
  const out: Record<string, OrderState> = { ...states };
  switch (def.behavior) {
    case 'armed':
      for (const d of Object.keys(out)) if (out[d]?.armed === true) out[d] = { ...out[d]!, armed: false };
      out[id] = { ...cur, armed: cur.armed !== true };
      return { states: out, countdown: null };
    case 'toggle':
      out[id] = { ...cur, toggle: cur.toggle === 'on' ? 'off' : 'on' };
      return { states: out, countdown: null };
    case 'cycle':
      out[id] = { ...cur, cycle: ((cur.cycle ?? 0) + 1) % FIRE_STATES.length };
      return { states: out, countdown: null };
    case 'instant':
      for (const d of Object.keys(out)) if (out[d]?.armed === true) out[d] = { ...out[d]!, armed: false };
      return { states: out, countdown: null };
    case 'countdown':
      return { states, countdown: countdownRunning ? 'abort' : 'start' };
  }
}

/**
 * Gallery commands that first call `base` (recording) and then change the model the way the game would:
 * tabs, placement, factory queue (+1/+5/−1/−5), armed/toggle/cycle orders, the self-destruct countdown
 * (static, no timer), cancel, groups and the 140-ms cell flash.
 */
export function createCardDemoCommands(model: HudModel, base: HudCommands): HudCommands {
  const flash = (slot: SlotCode): void => {
    model.card.flashSlot.value = slot;
    setTimeout(() => {
      if (model.card.flashSlot.peek() === slot) model.card.flashSlot.value = null;
    }, CELL_FLASH_MS);
  };
  return {
    ...base,
    setTab(tier) {
      base.setTab(tier);
      model.card.tab.value = tier;
    },
    cardActivate(slot, mods) {
      base.cardActivate(slot, mods);
      const spec = resolveCardPage(model.units.peek(), model.card.selectedTypes.peek(), model.card.tab.peek());
      const cell = spec.cells.find((c) => c.slot === slot);
      if (cell === undefined || cell.kind === 'empty' || cell.locked !== null) return;
      flash(slot);
      if (spec.page === 'production' && cell.kind === 'unit' && cell.typeId !== null) {
        const n = mods.shift ? 5 : 1;
        const q = { ...model.card.queueCounts.peek() };
        q[cell.typeId] = Math.max(0, (q[cell.typeId] ?? 0) + (mods.button === 2 ? -n : n));
        if (q[cell.typeId] === 0) delete q[cell.typeId];
        model.card.queueCounts.value = q;
        return;
      }
      if (spec.page === 'build' && cell.kind === 'unit') {
        const units = model.units.peek();
        const armed = model.card.armedSlot.peek() === slot;
        // Right click on the armed cell ends the placement (like Esc, ui.md §7.6).
        if (mods.button === 2) {
          if (armed) {
            batch(() => {
              model.card.armedSlot.value = null;
              model.card.placingTypeId.value = null;
            });
          }
          return;
        }
        if (mods.button !== 0) return;
        if (!armed) {
          batch(() => {
            model.card.armedSlot.value = slot;
            model.card.placingTypeId.value = findUnit(units, cell.typeId ?? '')?.id ?? null;
          });
          return;
        }
        // Hotbuild cycle (ui.md §5.6, roster.json hotbuildGrid.rule): pressing the armed key again only
        // changes the tier of the role (highest → lower → wrap), never cancels; the tech tab follows.
        const placing = model.card.placingTypeId.peek();
        const current = (placing !== null ? findUnit(units, placing)?.tech : undefined) ?? cell.shownTier;
        const step = nextHotbuildTier(units, slot, current, model.card.selectedTypes.peek());
        if (step === null) return;
        batch(() => {
          model.card.placingTypeId.value = step.typeId;
          if (isTechTier(step.tier)) model.card.tab.value = step.tier;
        });
      }
    },
    cancelMode() {
      base.cancelMode();
      batch(() => {
        model.card.armedSlot.value = null;
        model.card.placingTypeId.value = null;
        const states: Record<string, OrderState> = { ...model.orders.states.peek() };
        for (const k of Object.keys(states)) if (states[k]?.armed === true) states[k] = { ...states[k]!, armed: false };
        model.orders.states.value = states;
      });
    },
    activateOrder(id, mods) {
      base.activateOrder(id, mods);
      const running = model.orders.selfDestructCountdown.peek() !== null;
      const next = nextOrderStates(model.orders.states.peek(), id, running);
      batch(() => {
        model.orders.states.value = next.states;
        if (next.countdown === 'start') model.orders.selfDestructCountdown.value = SELF_DESTRUCT_SECONDS;
        if (next.countdown === 'abort') model.orders.selfDestructCountdown.value = null;
      });
    },
    recallGroup(index, mods) {
      base.recallGroup(index, mods);
      const g = model.strip.groups.peek()[index];
      if (g !== undefined && g.count > 0) model.strip.activeGroup.value = index;
    },
    saveGroup(index, add) {
      base.saveGroup(index, add);
      const groups = [...model.strip.groups.peek()];
      const cur = groups[index];
      const sel = model.card.selectedTypes.peek();
      if (cur === undefined || sel.length === 0) return;
      const count = (add ? cur.count : 0) + model.card.unitCount.peek();
      groups[index] = { count, iconTypeId: add && cur.iconTypeId !== null ? cur.iconTypeId : (sel[0] ?? null) };
      batch(() => {
        model.strip.groups.value = groups;
        model.strip.activeGroup.value = index;
      });
    },
  };
}
