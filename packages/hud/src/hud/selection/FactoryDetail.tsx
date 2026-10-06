import { useComputed } from '@preact/signals';
import type { JSX } from 'preact';
import { fmtInt } from '../../format/index.ts';
import { locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import { bpTotal, factoryStructureKey } from '../../model/factory.ts';
import { useHud, useUnitCatalog } from '../../model/index.ts';
import { cx } from '../../ui/cx.ts';
import { FactoryQueue } from './FactoryQueue.tsx';
import { adjacencyText, bpParts, helperCount, helpersText, ofText, rallyText, unitRole } from './labels.ts';
import { unitName } from '../../data/roster.ts';
import { Meter, Portrait } from './parts.tsx';
import { SelectionEmpty } from './SelectionEmpty.tsx';

/**
 * Factory selection (ui.md §5.5 "Fabrik" `FactoryDetail`): portrait, HP, build power own + assist
 * ("20 + 15 = 35", B2), helper list, adjacency bonus (E11), rally state; the FactoryQueue on the right.
 * Re-renders when the structure key changes; HP (4 Hz) is bound.
 */
export function FactoryDetail(): JSX.Element {
  const { factory } = useHud();
  const key = useComputed(() => factoryStructureKey(factory.detail.value));
  if (key.value === '') return <SelectionEmpty />;
  return <FactoryDetailBody key={key.value} />;
}

function FactoryDetailBody(): JSX.Element {
  const { factory } = useHud();
  const loc = locale.value;
  const units = useUnitCatalog();
  const d = factory.detail.peek()!;
  const hp = useComputed(() => {
    const s = factory.detail.value;
    return s === null || !(s.hpMax > 0) ? 0 : s.hp / s.hpMax;
  });
  const hpText = useComputed(() => {
    const s = factory.detail.value;
    return s === null ? '' : ofText(s.hp, s.hpMax, locale.value);
  });
  const total = bpTotal(d);
  const bp = bpParts(d, loc);
  const helpers = helperCount(d.helpers);
  return (
    <div class="sel__body sel__body--factory" role="group" data-kind="factory" data-testid="factory-detail" data-component="FactoryDetail" aria-label={t('ui.factory.detail')}>
      <Portrait typeId={d.typeId} />
      <div class="uinfo">
        <div class="uinfo__name">
          <b data-testid="factory-name">{unitName(units, d.typeId, loc)}</b>
          <span>{unitRole(units, d.typeId, loc)}</span>
        </div>
        <Meter label={t('ui.selection.meter.hp')} kind="hp" value={hp} text={hpText} testId="meter-hp" />
        <Meter
          label={t('ui.factory.bp')}
          kind="build"
          level="normal"
          barClass="is-bp"
          value={total > 0 ? d.bpOwn / total : 0}
          text={
            <>
              {bp.sum}
              <b class="meter__total">{bp.total}</b>
            </>
          }
          testId="meter-bp"
        />
        <div class="stats" data-testid="factory-helpers">
          <span>
            {t('ui.factory.helpers')} <b>{fmtInt(helpers, loc)}</b> <span class="ff-lo">{helpersText(units, d.helpers, loc)}</span>
          </span>
          <span>
            {t('ui.factory.adjacency')}{' '}
            <b class={cx(d.adjacencyPct > 0 && 'is-adjacency')} data-testid="factory-adjacency">
              {adjacencyText(d.adjacencyPct, loc)}
            </b>
          </span>
        </div>
        <div class="stats" data-testid="factory-rally-state">
          <span>
            {t('ui.factory.rally')}{' '}
            <b class={cx(d.rally !== 'none' && 'is-set')} data-rally={d.rally}>
              {rallyText(d.rally, loc)}
            </b>{' '}
            <span class="ff-lo">{t('ui.factory.rallyHint')}</span>
          </span>
        </div>
      </div>
      <FactoryQueue />
    </div>
  );
}
