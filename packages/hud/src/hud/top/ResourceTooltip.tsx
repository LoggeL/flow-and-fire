/**
 * Resource tooltip content (ui.md §5.1 "Tooltip am Meter", §5.12): income, usage, net, storage, flow and the
 * forecast ("leer/voll in N s") in the value grid, the stall/overflow state with symbol + text, income by
 * source and storage by building. Values are sampled at 4 Hz while open (never subscribed at 10 Hz).
 */
import type { JSX } from 'preact';
import { unitName } from '../../data/roster.ts';
import { fmtDec, fmtInt, fmtPct, fmtRate, fmtSigned } from '../../format/index.ts';
import { locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import { useHud } from '../../model/index.ts';
import type { IncomeEntry, ResourceKind, ResourceStatus, StorageEntry } from '../../model/eco.ts';
import { resourceForecast } from '../../model/tooltip.ts';
import type { ResourceForecast } from '../../model/tooltip.ts';
import { Key } from '../../ui/Key.tsx';
import { LevelSymbol } from '../../ui/LevelSymbol.tsx';
import { ResourceGlyph } from '../../ui/ResourceGlyph.tsx';
import { TooltipFrame } from '../../ui/TooltipFrame.tsx';
import type { TooltipStat } from '../../ui/TooltipFrame.tsx';
import { cx } from '../../ui/cx.ts';
import { incomeSourceLabel, resourceLabel } from './labels.ts';
import { useSampled } from './sample.ts';

export interface ResourceTooltipProps {
  readonly resource: ResourceKind;
  readonly testId?: string | undefined;
}

/** Raw numbers of one resource (formatted during render, so a locale switch re-formats). */
export interface ResourceTooltipView {
  readonly stored: number;
  readonly capacity: number;
  readonly income: number;
  readonly served: number;
  readonly net: number;
  readonly flow: number;
  readonly status: ResourceStatus;
  readonly incomeBySource: readonly IncomeEntry[];
  readonly storageByBuilding: readonly StorageEntry[];
}

/** Key of a view for change detection at the displayed precision (0.1/s, whole storage, whole %). */
export function resourceViewKey(v: ResourceTooltipView): string {
  const r1 = (x: number): number => Math.round(x * 10);
  return [
    Math.round(v.stored),
    Math.round(v.capacity),
    r1(v.income),
    r1(v.served),
    r1(v.net),
    Math.round(v.flow * 100),
    v.status,
    v.incomeBySource.map((e) => `${e.source}:${r1(e.perSec)}`).join(','),
    v.storageByBuilding.map((e) => `${e.typeId}:${e.count}:${e.capacity}`).join(','),
  ].join('|');
}

function forecastText(f: ResourceForecast): string {
  switch (f.kind) {
    case 'emptyIn':
      return t('ui.tooltip.resource.emptyIn', { n: f.seconds });
    case 'fullIn':
      return t('ui.tooltip.resource.fullIn', { n: f.seconds });
    case 'full':
      return t('ui.tooltip.resource.full');
    case 'empty':
      return t('ui.tooltip.resource.empty');
    default:
      return t('ui.tooltip.resource.steady');
  }
}

function StateLine({ v }: { readonly v: ResourceTooltipView }): JSX.Element | null {
  if (v.status === 'stall') {
    return (
      <div class="tip-res__state is-crit" data-testid="tooltip-res-state">
        <LevelSymbol level="crit" decorative />
        <span>{t('ui.tooltip.resource.stall', { pct: fmtPct(v.flow) })}</span>
      </div>
    );
  }
  if (v.status === 'overflow') {
    return (
      <div class="tip-res__state is-warn" data-testid="tooltip-res-state">
        <LevelSymbol level="warn" decorative />
        <span>{t('ui.tooltip.resource.overflow', { value: fmtDec(v.net, 1) })}</span>
      </div>
    );
  }
  if (v.status === 'stallSoon') {
    return (
      <div class="tip-res__state is-warn" data-testid="tooltip-res-state">
        <LevelSymbol level="warn" decorative />
        <span>{forecastText(resourceForecast(v.stored, v.capacity, v.net))}</span>
      </div>
    );
  }
  return null;
}

export function ResourceTooltip({ resource, testId }: ResourceTooltipProps): JSX.Element {
  const model = useHud();
  const r = model.eco[resource];
  const units = model.units.value;
  const loc = locale.value;
  const v = useSampled<ResourceTooltipView>(
    () => ({
      stored: r.stored.value,
      capacity: r.capacity.value,
      income: r.income.value,
      served: r.served.value,
      net: r.net.value,
      flow: r.flow.value,
      status: r.status.value,
      incomeBySource: r.incomeBySource.value,
      storageByBuilding: r.storageByBuilding.value,
    }),
    resourceViewKey,
  );
  const forecast = resourceForecast(v.stored, v.capacity, v.net);
  const stats: TooltipStat[] = [
    { label: t('ui.tooltip.resource.income'), value: fmtRate(v.income, 1, true) },
    { label: t('ui.tooltip.resource.usage'), value: fmtRate(-v.served, 1, true) },
    { label: t('ui.tooltip.resource.net'), value: fmtRate(v.net, 1, true) },
    { label: t('ui.tooltip.resource.storage'), value: t('ui.common.of', { value: fmtInt(v.stored), max: fmtInt(v.capacity) }) },
    { label: t('ui.tooltip.resource.flow'), value: fmtPct(v.flow) },
    { label: t('ui.tooltip.resource.eta'), value: forecastText(forecast) },
  ];
  const sources = v.incomeBySource.filter((e) => e.perSec !== 0);
  return (
    <div class="tip-res" data-component="ResourceTooltip" data-testid={testId ?? `resource-tooltip-${resource}`} data-res={resource}>
      <TooltipFrame
        icon={<ResourceGlyph kind={resource} decorative />}
        name={resourceLabel(resource, loc)}
        role={t('ui.tooltip.resource.role')}
        stats={stats}
        body={
          <>
            <StateLine v={v} />
            {sources.length > 0 ? (
              <div class="tip-res__list" data-testid="tooltip-res-sources">
                <div class="tip-res__h">{t('ui.tooltip.resource.bySource')}</div>
                {sources.map((e) => (
                  <div class="tip-res__row" key={e.source}>
                    <span>{incomeSourceLabel(e.source, loc)}</span>
                    <span class={cx('num', e.perSec < 0 && 'is-neg')}>{fmtSigned(e.perSec, 1)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {v.storageByBuilding.length > 0 ? (
              <div class="tip-res__list" data-testid="tooltip-res-storage">
                <div class="tip-res__h">{t('ui.tooltip.resource.byBuilding')}</div>
                {v.storageByBuilding.map((e) => {
                  const name = unitName(units, e.typeId, loc);
                  return (
                    <div class="tip-res__row" key={e.typeId}>
                      <span>{e.count > 1 ? t('ui.eco.consumer.count', { name, n: e.count }) : name}</span>
                      <span class="num">{fmtInt(e.capacity)}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        }
        foot={
          <span>
            <Key>{t('ui.common.key.click')}</Key>
            {t('ui.tooltip.resource.hint')}
          </span>
        }
        testId="resource-tooltip-frame"
      />
    </div>
  );
}
