/**
 * Resource bar (ui.md §5.1): two ResourceMeters (mass, energy) and the FlowDetails panel below them.
 * Hot values (10 Hz) are bound as computed signals straight into text nodes / attributes, so a tick never
 * re-renders the meter; only a change of the meter state (normal/overflow/stall soon/stall) re-renders the
 * small state slot at the end of the flow line.
 */
import { computed } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { MINUS, fmtDec, fmtInt, fmtPct, fmtSigned, padFigures } from '../../format/index.ts';
import { locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import { useCommands, useHud, useUnitCatalog } from '../../model/index.ts';
import {
  consumerRequest,
  consumerServed,
  isBottleneck,
  netLevel,
  overallFlow,
  pausedCount,
  storageFill,
  topConsumers,
  wholeSecondsToEmpty,
} from '../../model/eco.ts';
import type { EcoSection, FlowConsumer, ResourceKind, ResourceSignals, ResourceStatus } from '../../model/eco.ts';
import { Badge } from '../../ui/Badge.tsx';
import { Bar } from '../../ui/Bar.tsx';
import type { BarLevel } from '../../ui/Bar.tsx';
import { Key } from '../../ui/Key.tsx';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { PanelHead } from '../../ui/Panel.tsx';
import { ResourceGlyph } from '../../ui/ResourceGlyph.tsx';
import { cx } from '../../ui/cx.ts';
import { META_SEPARATOR, consumerLabel, priorityLabel, resourceLabel } from './labels.ts';

/** DOM id of the flow details panel (aria-controls of both meters). */
export const FLOW_DETAILS_ID = 'ff-flow-details';

const STATUS_CLASS: Readonly<Record<ResourceStatus, string | null>> = {
  normal: null,
  overflow: 'is-overflow',
  stallSoon: 'is-stall-soon',
  stall: 'is-stall',
};

/** Text of the state slot / badge ("Stall · Flow 72 %", "Voll · verfällt", "Leer in 7 s"), '' when normal. */
export function meterStateText(r: ResourceSignals): string {
  const status = r.status.value;
  if (status === 'stall') return t('ui.eco.meter.stall', { pct: fmtPct(r.flow.value) });
  if (status === 'overflow') return t('ui.eco.meter.overflow');
  if (status === 'stallSoon') return t('ui.eco.meter.emptyIn', { n: wholeSecondsToEmpty(r.stored.value, r.net.value) });
  return '';
}

interface MeterBindings {
  readonly root: ReadonlySignal<string>;
  readonly status: ReadonlySignal<ResourceStatus>;
  readonly expanded: ReadonlySignal<boolean>;
  readonly label: ReadonlySignal<string>;
  readonly stored: ReadonlySignal<string>;
  /** Stored value padded to a constant width (display; the aria label uses `stored`). */
  readonly storedText: ReadonlySignal<string>;
  readonly capacity: ReadonlySignal<string>;
  readonly net: ReadonlySignal<string>;
  /** Net padded to a constant width (display; the aria label uses `net`). */
  readonly netText: ReadonlySignal<string>;
  readonly netClass: ReadonlySignal<string>;
  readonly netTitle: ReadonlySignal<string>;
  readonly fill: ReadonlySignal<number>;
  readonly barLevel: ReadonlySignal<BarLevel>;
  readonly income: ReadonlySignal<string>;
  readonly usage: ReadonlySignal<string>;
  readonly flow: ReadonlySignal<string>;
  /** Flow padded to three digits (display). */
  readonly flowText: ReadonlySignal<string>;
  readonly stateText: ReadonlySignal<string>;
}

/** Computed bindings of one meter; each is a leaf (text, attribute, class) written only when its string changes. */
function meterBindings(kind: ResourceKind, r: ResourceSignals, eco: EcoSection): MeterBindings {
  const stored = computed(() => fmtInt(r.stored.value));
  const capacity = computed(() => `/ ${fmtInt(r.capacity.value)}`);
  const net = computed(() => fmtSigned(r.net.value, 1));
  const flow = computed(() => fmtPct(r.flow.value));
  const stateText = computed(() => meterStateText(r));
  return {
    status: r.status,
    root: computed(() =>
      cx('res', `res--${kind}`, 'ff-panel', STATUS_CLASS[r.status.value], eco.detailsOpen.value && 'is-open'),
    ),
    expanded: computed(() => eco.detailsOpen.value),
    label: computed(() => {
      const base = t('ui.eco.meter.label', {
        resource: resourceLabel(kind, locale.value),
        stored: stored.value,
        capacity: fmtInt(r.capacity.value),
        net: net.value,
        flow: flow.value,
      });
      return stateText.value ? `${base}${META_SEPARATOR}${stateText.value}` : base;
    }),
    stored,
    // Constant widths (padFigures): values up to 99.999 / ±999,9 / 999,9 / 100 % never move their neighbours
    // or their own start point at 10 Hz (layout-shift gate of the perf harness, ui.md §9.2/§9.3).
    storedText: computed(() => padFigures(stored.value, 5, 1)),
    capacity,
    net,
    netText: computed(() => padFigures(net.value, 5, 1)),
    netClass: computed(() => {
      const status = r.status.value;
      return cx('res__net', 'num', `is-${netLevel(r.net.value)}`, status === 'stallSoon' && 'is-soon');
    }),
    netTitle: computed(() => {
      const status = r.status.value;
      if (status === 'stall') return t('ui.eco.meter.deficitTitle');
      if (status === 'stallSoon') return stateText.value;
      return t('ui.eco.meter.netTitle');
    }),
    fill: computed(() => storageFill(r.stored.value, r.capacity.value)),
    barLevel: computed<BarLevel>(() => (r.status.value === 'stall' ? 'crit' : r.status.value === 'overflow' ? 'warn' : 'normal')),
    income: computed(() => padFigures(fmtDec(r.income.value, 1), 4, 1)),
    usage: computed(() => padFigures(fmtDec(r.served.value, 1), 4, 1)),
    flow,
    flowText: computed(() => padFigures(flow.value, 3)),
    stateText,
  };
}

/** Flow line end: "Flow 100 %", or a badge with symbol + text for stall / overflow / stall soon (never colour alone). */
function MeterState({ b }: { readonly b: MeterBindings }): JSX.Element {
  // Subscribes to the (rarely changing) status only; the texts inside stay signal bindings.
  const status = b.status.value;
  if (status === 'stall') {
    return (
      <span class="eff" data-testid="meter-state">
        <Badge tone="crit" icon="crit" testId="meter-badge">
          {b.stateText}
        </Badge>
      </span>
    );
  }
  if (status === 'overflow' || status === 'stallSoon') {
    return (
      <span class="eff" data-testid="meter-state">
        <Badge tone="warn" icon="warn" testId="meter-badge">
          {b.stateText}
        </Badge>
      </span>
    );
  }
  return (
    <span class="eff" data-testid="meter-state">
      {t('ui.eco.meter.flow')} <b>{b.flowText}</b>
    </span>
  );
}

export interface ResourceMeterProps {
  readonly kind: ResourceKind;
  /** Id of the flow details panel it controls (default FLOW_DETAILS_ID). */
  readonly detailsId?: string | undefined;
}

/**
 * One resource meter (312 × 60 px @1.0): glyph, storage large / capacity small, net right (green/red/grey,
 * U+2212), storage bar (scaleX), flow line (+income, −usage, flow %). Click toggles the flow details.
 */
export function ResourceMeter({ kind, detailsId = FLOW_DETAILS_ID }: ResourceMeterProps): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const eco = model.eco;
  const r = eco[kind];
  const b = useMemo(() => meterBindings(kind, r, eco), [kind, r, eco]);
  return (
    <button
      type="button"
      class={b.root}
      data-component="ResourceMeter"
      data-testid={`resource-meter-${kind}`}
      data-panel={`res-${kind}`}
      data-res={kind}
      data-status={b.status}
      data-tip={`resource:${kind}`}
      aria-label={b.label}
      aria-expanded={b.expanded}
      aria-controls={detailsId}
      onClick={() => commands.toggleFlowDetails()}
    >
      <span class="res__glyph">
        <ResourceGlyph kind={kind} decorative />
      </span>
      <span class="res__store num" data-testid="meter-stored">
        {b.storedText}
        <small data-testid="meter-capacity">{b.capacity}</small>
      </span>
      <span class={b.netClass} title={b.netTitle} data-testid="meter-net">
        {b.netText}
      </span>
      <Bar kind={kind} value={b.fill} level={b.barLevel} class="res__bar" testId="meter-bar" />
      <span class="res__flow num">
        <span class="in">
          {'+'}
          <b data-testid="meter-income">{b.income}</b>
        </span>
        <span class="out">
          {MINUS}
          <b data-testid="meter-usage">{b.usage}</b>
        </span>
        <MeterState b={b} />
      </span>
    </button>
  );
}

interface FlowRowProps {
  readonly c: FlowConsumer;
  readonly res: ResourceKind;
  readonly interactive: boolean;
}

function FlowRow({ c, res, interactive }: FlowRowProps): JSX.Element {
  const commands = useCommands();
  const want = consumerRequest(c, res);
  const got = consumerServed(c, res);
  const bottleneck = isBottleneck(c, res);
  const units = useUnitCatalog();
  const name = consumerLabel(units, c, locale.value);
  return (
    <div
      class={cx('flow__row', c.paused && 'is-paused', bottleneck && 'is-bottleneck')}
      data-testid={`flow-row-${res}-${c.id}`}
      data-consumer={c.id}
    >
      <StrategicIcon typeId={c.typeId} />
      <span class="flow__name">{name}</span>
      <span
        class="num flow__got"
        title={bottleneck ? t('ui.eco.details.bottleneck', { name, got: fmtDec(got, 1), want: fmtDec(want, 1) }) : undefined}
      >
        {fmtDec(got, 1)}
      </span>
      <span class="num want">
        {'/ '}
        {fmtDec(want, 1)}
      </span>
      {interactive ? (
        <button
          type="button"
          class={cx('flow__pause', c.paused && 'is-on')}
          aria-pressed={c.paused}
          aria-label={t(c.paused ? 'ui.eco.details.resume' : 'ui.eco.details.pause', { name })}
          title={t(c.paused ? 'ui.eco.details.resume' : 'ui.eco.details.pause', { name })}
          data-testid={`flow-pause-${res}-${c.id}`}
          onClick={() => commands.pauseConsumer(c.id, !c.paused)}
        >
          <LineIcon name={c.paused ? 'play' : 'pause'} />
        </button>
      ) : (
        <span class="flow__ro" />
      )}
    </div>
  );
}

function FlowColumn({ res }: { readonly res: ResourceKind }): JSX.Element {
  const eco = useHud().eco;
  const rows = topConsumers(eco.consumers.value, res);
  const interactive = eco.interactive.value;
  return (
    <div class="flow__col" data-testid={`flow-col-${res}`}>
      <div class="flow__head">
        <span class={`flow__res--${res}`}>{t(res === 'mass' ? 'ui.eco.details.massPerS' : 'ui.eco.details.energyPerS')}</span>
        <span>{t('ui.eco.details.gotWant')}</span>
      </div>
      {rows.length === 0 ? <div class="flow__empty">{t('ui.eco.details.empty')}</div> : null}
      {rows.map((c) => (
        <FlowRow key={c.id} c={c} res={res} interactive={interactive} />
      ))}
    </div>
  );
}

/** Panel head end: "kein Engpass" or a crit badge "alle Verbraucher 72 %" (re-renders only when a stall starts/ends). */
function FlowHeadState(): JSX.Element {
  const eco = useHud().eco;
  const b = useMemo(() => {
    const flow = computed(() => overallFlow(eco.mass.flow.value, eco.energy.flow.value));
    return {
      stalled: computed(() => flow.value < 1),
      text: computed(() => t('ui.eco.details.allThrottled', { pct: fmtPct(flow.value) })),
    };
  }, [eco]);
  if (!b.stalled.value) return <span data-testid="flow-state">{t('ui.eco.details.noBottleneck')}</span>;
  return (
    <Badge tone="crit" icon="crit" testId="flow-state">
      {b.text}
    </Badge>
  );
}

function FlowDetailsPanel({ id }: { readonly id: string }): JSX.Element {
  const eco = useHud().eco;
  const consumers = eco.consumers.value;
  const interactive = eco.interactive.value;
  const paused = pausedCount(consumers);
  return (
    <section
      id={id}
      class="flow ff-panel"
      data-component="FlowDetails"
      data-testid="flow-details"
      data-panel="flow-details"
      aria-label={t('ui.eco.details.title')}
    >
      <PanelHead title={t('ui.eco.details.title')} end={<FlowHeadState />} />
      <div class="flow__body">
        <FlowColumn res="mass" />
        <FlowColumn res="energy" />
      </div>
      <div class="flow__foot">
        {paused > 0 ? (
          <span class="flow__paused" data-testid="flow-paused">
            <LineIcon name="pause" />
            {t('ui.eco.details.paused', { n: paused })}
          </span>
        ) : null}
        <span class="flow__prio">
          {t('ui.eco.details.priority')} <b>{priorityLabel(eco.stallPriority.value, locale.value)}</b>
        </span>
        {interactive ? null : (
          <span class="flow__readonly" data-testid="flow-readonly">
            {t('ui.eco.details.readOnly')}
          </span>
        )}
        <span class="flow__hint">
          <Key>{t('ui.common.key.click')}</Key>
          {t('ui.eco.details.toggleHint')}
        </span>
      </div>
    </section>
  );
}

export interface FlowDetailsProps {
  readonly id?: string | undefined;
}

/**
 * Flow details (628 px, under the bar): the largest consumers per resource with "erhält / Bedarf",
 * bottleneck marker, pause button per row (E13, only when eco.interactive; read-only before) and the
 * stall priority. Renders nothing while closed. Consumers arrive at 4 Hz (scheduler) and re-render the body.
 */
export function FlowDetails({ id = FLOW_DETAILS_ID }: FlowDetailsProps): JSX.Element | null {
  const eco = useHud().eco;
  if (!eco.detailsOpen.value) return null;
  return <FlowDetailsPanel id={id} />;
}

/** Resource bar top left: mass + energy meters and the flow details they toggle. */
export function ResourceBar(): JSX.Element {
  return (
    <>
      <section class="eco" data-component="ResourceBar" data-testid="resource-bar" aria-label={t('ui.eco.bar')}>
        <ResourceMeter kind="mass" />
        <ResourceMeter kind="energy" />
      </section>
      <FlowDetails />
    </>
  );
}
