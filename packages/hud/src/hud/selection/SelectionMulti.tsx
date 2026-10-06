import { useComputed } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { iconMaskClass, iconOf } from '../../data/icons.ts';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { fmtDec, fmtInt, fmtPct } from '../../format/index.ts';
import { locale } from '../../i18n/locale.ts';
import { t, tn } from '../../i18n/t.ts';
import { useCommands, useHud, useUnitCatalog } from '../../model/index.ts';
import { MULTI_MAX_GROUPS, MULTI_MAX_UNITS, hpLevel, tileAction, visibleCount } from '../../model/selection.ts';
import type { MultiSelectionData } from '../../model/selection.ts';
import { clamp01, useBindEffect } from '../../ui/bind.ts';
import { Key } from '../../ui/Key.tsx';
import { VET_MAX } from '../../ui/Vet.tsx';
import { TILE_GEOMETRY, UNIT_GEOMETRY, gridCapacity, useBoxSize } from './capacity.ts';
import { closestData, pointerMods } from './events.ts';
import { unitName } from '../../data/roster.ts';

/** Writes a CSS variable only when its string changes. */
function setVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

/** Toggles a class only when its state changes (no attribute write, no mutation record otherwise). */
function setClass(el: HTMLElement, name: string, on: boolean): void {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

function setLevel(el: HTMLElement, fraction: number): void {
  const l = hpLevel(fraction);
  setClass(el, 'is-warn', l === 'warn');
  setClass(el, 'is-crit', l === 'crit');
}

/**
 * Type tiles of a multi selection (ui.md §5.5 `SelectionGroups`, 68 × 76 px): one row of fixed slots
 * (≤ 24, more → "+N"). A tile is `<button>` + `<svg><use>` + count + damaged count; the HP bar (::after)
 * and vet diamonds (::after of the damaged count) are pseudo elements → 5 DOM nodes per tile.
 * Click = only this type, Shift = remove the type, Ctrl = only its damaged units (ui.md §7.3).
 * Renders on selection changes only; group HP/damaged/vet (4 Hz) and the focus type are written to
 * CSS variables, classes and textContent of the existing nodes.
 */
export function SelectionGroups(): JSX.Element {
  const { selection, scale } = useHud();
  const commands = useCommands();
  const rootRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dmgRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const size = useBoxSize(rootRef);
  const capacity = useComputed(() => gridCapacity(size.value, TILE_GEOMETRY, 16 * scale.value, MULTI_MAX_GROUPS, 1));
  const multi: MultiSelectionData | null = selection.multi.value;
  const groups = multi?.groups ?? [];
  const { shown, more } = visibleCount(groups.length, capacity.value);
  const loc = locale.value;
  const units = useUnitCatalog();
  tileRefs.current.length = shown;
  dmgRefs.current.length = shown;

  useBindEffect(() => {
    const st = selection.multiStats.value;
    const focus = selection.focusTypeId.value;
    const l = locale.value;
    for (let i = 0; i < shown; i++) {
      const tile = tileRefs.current[i];
      const dmg = dmgRefs.current[i];
      if (!tile || !dmg) continue;
      const hp = st !== null && i < st.groupHp.length ? clamp01(st.groupHp[i]!) : 1;
      const damaged = st !== null && i < st.groupDamaged.length ? st.groupDamaged[i]! : 0;
      const vet = st !== null && i < st.groupVet.length ? Math.min(VET_MAX, st.groupVet[i]!) : 0;
      setVar(tile, '--v', String(hp));
      setVar(tile, '--vet', String(vet));
      setLevel(tile, hp);
      const text = damaged > 0 ? t('ui.selection.tileDamaged', { n: fmtInt(damaged, l) }, l) : '';
      if (dmg.textContent !== text) dmg.textContent = text;
      const focused = groups[i]!.typeId === focus;
      setClass(tile, 'is-focus', focused);
      if (focused !== tile.hasAttribute('aria-current')) {
        if (focused) tile.setAttribute('aria-current', 'true');
        else tile.removeAttribute('aria-current');
      }
    }
  }, [multi, shown]);

  const onClick = (e: MouseEvent): void => {
    const root = rootRef.current;
    const tile = root ? closestData(e.target, root, 'type') : null;
    if (tile === null) return;
    const typeId = tile.dataset['type']!;
    const action = tileAction(pointerMods(e));
    if (action === 'deselect') commands.deselectType(typeId);
    else if (action === 'damaged') commands.selectDamagedOfType(typeId);
    else commands.selectType(typeId);
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    // Ctrl+left click on macOS arrives as contextmenu (button 0): "only damaged of this type".
    if (e.button === 0) onClick(e);
  };

  const tiles: JSX.Element[] = [];
  for (let i = 0; i < shown; i++) {
    const g = groups[i]!;
    const name = unitName(units, g.typeId, loc);
    tiles.push(
      <button
        key={g.typeId}
        ref={(el) => {
          tileRefs.current[i] = el;
        }}
        type="button"
        class="tile"
        data-type={g.typeId}
        data-testid="selection-tile"
        title={t('ui.selection.tile', { name, n: fmtInt(g.count, loc) })}
      >
        <StrategicIcon typeId={g.typeId} />
        <span class="tile__n num">{t('ui.selection.tileCount', { n: fmtInt(g.count, loc) })}</span>
        <span
          ref={(el) => {
            dmgRefs.current[i] = el;
          }}
          class="tile__dmg num"
        />
      </button>,
    );
  }
  if (more > 0) {
    tiles.push(
      <span key="+" class="tile is-more" role="img" aria-label={tn('ui.selection.moreTypes', more)} data-testid="selection-tile-more">
        {t('ui.common.more', { n: fmtInt(more, loc) })}
      </span>,
    );
  }

  return (
    <div
      ref={rootRef}
      class="tiles"
      role="group"
      aria-label={t('ui.selection.groups')}
      data-component="SelectionGroups"
      data-testid="selection-groups"
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {tiles}
    </div>
  );
}

/**
 * Single units of a multi selection (ui.md §5.5 `SelectionUnits`, 34 × 38 px, ≤ 60): exactly one
 * `<button>` per unit – the icon is a CSS mask (icons-mask.gen.css) on ::before, the HP strip ::after with
 * scaleX(var(--v)), warn/crit as classes (ui.md §9.2). Slots that do not fit the panel become "+N".
 * Click = only this unit, Shift = deselect, Ctrl = its type (selectUnit with the modifiers).
 */
export function SelectionUnits(): JSX.Element {
  const { selection, scale } = useHud();
  const commands = useCommands();
  const rootRef = useRef<HTMLDivElement>(null);
  const unitRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const size = useBoxSize(rootRef);
  const capacity = useComputed(() => gridCapacity(size.value, UNIT_GEOMETRY, 16 * scale.value, MULTI_MAX_UNITS));
  const multi = selection.multi.value;
  const units = multi?.units ?? [];
  const hidden = multi !== null && units.length === 0 && multi.total > 0;
  const { shown, more } = visibleCount(Math.min(units.length, MULTI_MAX_UNITS), capacity.value);
  const loc = locale.value;
  const catalog = useUnitCatalog();
  unitRefs.current.length = shown;

  useBindEffect(() => {
    const st = selection.multiStats.value;
    for (let i = 0; i < shown; i++) {
      const el = unitRefs.current[i];
      if (!el) continue;
      const hp = st !== null && i < st.unitHp.length ? clamp01(st.unitHp[i]!) : 1;
      setVar(el, '--v', String(hp));
      setLevel(el, hp);
    }
  }, [multi, shown]);

  const pick = (e: MouseEvent): void => {
    const root = rootRef.current;
    const el = root ? closestData(e.target, root, 'handle') : null;
    if (el === null) return;
    commands.selectUnit(Number(el.dataset['handle']), pointerMods(e));
  };
  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    pick(e);
  };

  const items: JSX.Element[] = [];
  for (let i = 0; i < shown; i++) {
    const u = units[i]!;
    const icon = iconOf(catalog, u.typeId);
    items.push(
      <button
        key={u.handle}
        ref={(el) => {
          unitRefs.current[i] = el;
        }}
        type="button"
        class={icon !== null ? `unit ${iconMaskClass(icon)}` : 'unit'}
        data-handle={u.handle}
        data-testid="selection-unit"
        title={t('ui.selection.unit', { name: unitName(catalog, u.typeId, loc) })}
      />,
    );
  }
  if (more > 0) {
    items.push(
      <span key="+" class="unit is-more" role="img" aria-label={tn('ui.selection.moreUnits', more)} data-testid="selection-unit-more">
        {t('ui.common.more', { n: fmtInt(more, loc) })}
      </span>,
    );
  }

  return (
    <div
      ref={rootRef}
      class="units"
      role="group"
      aria-label={t('ui.selection.units')}
      data-component="SelectionUnits"
      data-testid="selection-units"
      onClick={pick}
      onContextMenu={onContextMenu}
    >
      {hidden ? (
        <span class="units__hint" data-testid="selection-units-hidden">
          {t('ui.selection.unitsHidden', { max: String(MULTI_MAX_UNITS) })}
        </span>
      ) : (
        items
      )}
    </div>
  );
}

/** Footer of a multi selection: Σ DPS, Σ Mass, Ø HP, speed of the slowest unit, Tab hint (text bindings). */
export function SelectionSummary(): JSX.Element {
  const { selection, keyboardLayout } = useHud();
  const dps = useComputed(() => fmtInt(selection.multiStats.value?.sumDps ?? 0, locale.value));
  const mass = useComputed(() => fmtInt(selection.multiStats.value?.sumMass ?? 0, locale.value));
  const hp = useComputed(() => fmtPct((selection.multiStats.value?.avgHpPct ?? 100) / 100, 0, locale.value));
  const speed = useComputed(() => fmtDec(selection.multiStats.value?.slowestSpeed ?? 0, 1, locale.value));
  return (
    <div class="sumrow num" role="group" aria-label={t('ui.selection.sum.title')} data-testid="selection-summary">
      <span>
        {t('ui.selection.sum.dps')} <b data-testid="sum-dps">{dps}</b>
      </span>
      <span>
        {t('ui.selection.sum.mass')} <b data-testid="sum-mass">{mass}</b>
      </span>
      <span>
        {t('ui.selection.sum.hp')} <b data-testid="sum-hp">{hp}</b>
      </span>
      <span>
        {t('ui.selection.sum.speed')} <b data-testid="sum-speed">{speed}</b> <span class="ff-lo">{t('ui.selection.sum.slowest')}</span>
      </span>
      <span class="ff-lo sumrow__tab">
        <Key code="Tab" layout={keyboardLayout.value} /> {t('ui.selection.tabHint')}
      </span>
    </div>
  );
}

/** Multi selection body (ui.md §5.5 "Mehrfach"): type tiles, single units, totals. */
export function SelectionMulti(): JSX.Element {
  return (
    <div class="sel__body sel__body--multi" data-kind="multi" data-testid="selection-multi">
      <SelectionGroups />
      <SelectionUnits />
      <SelectionSummary />
    </div>
  );
}
