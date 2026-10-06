import { useComputed } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { fmtInt } from '../../format/index.ts';
import { locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import { useHud, useUnitCatalog } from '../../model/index.ts';
import { singleStructureKey } from '../../model/selection.ts';
import { useBindEffect } from '../../ui/bind.ts';
import { VET_MAX } from '../../ui/Vet.tsx';
import { isCommander, ofText, statDec, tapshotReady, tapshotText, unitRole, vetText, SEP } from './labels.ts';
import { unitName } from '../../data/roster.ts';
import { OrderQueue } from './OrderQueue.tsx';
import { Meter, Portrait } from './parts.tsx';
import { SelectionEmpty } from './SelectionEmpty.tsx';

/**
 * Single selection (ui.md §5.5 `UnitDetail`): portrait, name + role, HP / shield / vet / tap-shot bars,
 * stat line and the order chain. Re-renders only when the structure key changes (other unit, rows
 * appear/disappear); HP, vet, tap shot and order progress (4 Hz) are bound to text and CSS variables.
 */
export function UnitDetail(): JSX.Element {
  const { selection } = useHud();
  const key = useComputed(() => singleStructureKey(selection.single.value));
  // Subscribes to the structure key only; a new key remounts the body (fresh bindings).
  if (key.value === '') return <SelectionEmpty />;
  return <UnitDetailBody key={key.value} />;
}

function UnitDetailBody(): JSX.Element {
  const { selection } = useHud();
  const loc = locale.value;
  const units = useUnitCatalog();
  const d = selection.single.peek()!;
  const vetRef = useRef<HTMLSpanElement>(null);
  const tapRef = useRef<HTMLSpanElement>(null);

  const hp = useComputed(() => {
    const s = selection.single.value;
    return s === null || !(s.hpMax > 0) ? 0 : s.hp / s.hpMax;
  });
  const hpText = useComputed(() => {
    const s = selection.single.value;
    return s === null ? '' : ofText(s.hp, s.hpMax, locale.value);
  });
  const shield = useComputed(() => {
    const s = selection.single.value?.shield;
    return s === undefined || !(s.hpMax > 0) ? 0 : s.hp / s.hpMax;
  });
  const shieldText = useComputed(() => {
    const s = selection.single.value?.shield;
    return s === undefined ? '' : ofText(s.hp, s.hpMax, locale.value);
  });
  const vetProgress = useComputed(() => {
    const v = selection.single.value?.vet;
    return v === undefined ? 0 : v.level >= VET_MAX ? 1 : v.progress;
  });
  const vetLabel = useComputed(() => {
    const v = selection.single.value?.vet;
    return v === undefined ? '' : vetText(v, VET_MAX, locale.value);
  });
  const tap = useComputed(() => {
    const s = selection.single.value?.tapshot;
    return s === null || s === undefined || !(s.threshold > 0) ? 0 : s.stored / s.threshold;
  });
  const tapLabel = useComputed(() => {
    const s = selection.single.value?.tapshot;
    return s === null || s === undefined ? '' : tapshotText(s, locale.value);
  });

  // Vet diamonds and the tap-shot "ready" state: classes/attributes of existing nodes only.
  useBindEffect(() => {
    const s = selection.single.value;
    const vetEl = vetRef.current;
    if (s !== null && vetEl !== null) {
      const n = Math.max(0, Math.min(VET_MAX, Math.round(s.vet.level)));
      if (vetEl.dataset['level'] !== String(n)) {
        vetEl.dataset['level'] = String(n);
        for (let i = 0; i < vetEl.children.length; i++) vetEl.children[i]!.classList.toggle('on', i < n);
        vetEl.setAttribute('aria-label', t('ui.common.vet', { n, max: VET_MAX }, locale.value));
      }
    }
    const tapEl = tapRef.current;
    if (s !== null && s.tapshot !== null && tapEl !== null) {
      const ready = tapshotReady(s.tapshot);
      if (tapEl.classList.contains('is-ready') !== ready) tapEl.classList.toggle('is-ready', ready);
    }
  }, []);

  const st = d.stats;
  const commander = isCommander(units, d.typeId);
  const role = unitRole(units, d.typeId, loc);
  return (
    <div class="sel__body sel__body--single" role="group" data-kind="single" data-testid="unit-detail" data-component="UnitDetail" aria-label={t('ui.selection.detail')}>
      <Portrait typeId={d.typeId} vetRef={vetRef} vet={d.vet.level} />
      <div class="uinfo">
        <div class="uinfo__name">
          <b data-testid="unit-name">{unitName(units, d.typeId, loc)}</b>
          <span data-testid="unit-role">{commander ? `${role}${SEP}${t('ui.selection.commanderNote')}` : role}</span>
        </div>
        <Meter label={t('ui.selection.meter.hp')} kind="hp" value={hp} text={hpText} testId="meter-hp" />
        {d.shield !== undefined ? (
          <Meter label={t('ui.selection.meter.shield')} kind="shield" value={shield} level="normal" text={shieldText} testId="meter-shield" />
        ) : null}
        <Meter
          label={t('ui.selection.meter.vet')}
          kind="build"
          level="normal"
          barClass="is-vet"
          value={vetProgress}
          text={vetLabel}
          testId="meter-vet"
        />
        {d.tapshot !== null ? (
          <Meter
            label={t('ui.selection.meter.tapshot')}
            kind="energy"
            level="normal"
            value={tap}
            text={tapLabel}
            textClass="meter__tap"
            textRef={tapRef}
            testId="meter-tapshot"
          />
        ) : null}
        <div class="stats num" data-testid="unit-stats">
          <span>
            {t('ui.selection.stat.dps')} <b>{fmtInt(st.dps, loc)}</b>
          </span>
          <span>
            {t('ui.selection.stat.range')} <b>{fmtInt(st.range, loc)}</b>
          </span>
          <span>
            {t('ui.selection.stat.speed')} <b>{statDec(st.speed, loc)}</b>
          </span>
          <span>
            {t('ui.selection.stat.vision')} <b>{fmtInt(st.vision, loc)}</b>
          </span>
          {st.buildPower > 0 ? (
            <span>
              {t('ui.selection.stat.bp')} <b>{fmtInt(st.buildPower, loc)}</b>
            </span>
          ) : null}
          {st.regen > 0 ? (
            <span>
              {t('ui.selection.stat.regen')} <b>{t('ui.common.perSecond', { value: fmtInt(st.regen, loc) })}</b>
            </span>
          ) : null}
        </div>
      </div>
      <OrderQueue />
    </div>
  );
}
