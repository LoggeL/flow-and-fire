import type { ReadonlySignal } from '@preact/signals';
import type { ComponentChildren, JSX, Ref } from 'preact';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import { Bar } from '../../ui/Bar.tsx';
import type { BarKind, BarLevel } from '../../ui/Bar.tsx';
import { cx } from '../../ui/cx.ts';
import { VET_MAX } from '../../ui/Vet.tsx';
import { techLabel } from './labels.ts';
import { useUnitCatalog } from '../../model/index.ts';

export interface PortraitProps {
  readonly typeId: string;
  /** Veterancy diamonds under the icon; the ref receives the .ff-vet element for 4 Hz updates. */
  readonly vetRef?: Ref<HTMLSpanElement> | undefined;
  /** Initial vet level (0..5). */
  readonly vet?: number | undefined;
}

/** Portrait (104 px): large strategic icon, tech label (CMD/T1–T3/EXP), vet diamonds (U9). */
export function Portrait({ typeId, vetRef, vet }: PortraitProps): JSX.Element {
  const loc = locale.value;
  const units = useUnitCatalog();
  const pips: JSX.Element[] = [];
  const level = Math.max(0, Math.min(VET_MAX, vet ?? 0));
  if (vetRef !== undefined) for (let i = 0; i < VET_MAX; i++) pips.push(<i key={i} class={i < level ? 'on' : undefined} />);
  return (
    <div class="portrait" data-testid="portrait">
      <StrategicIcon typeId={typeId} />
      <span class="portrait__tech" data-testid="portrait-tech">
        {techLabel(units, typeId, loc)}
      </span>
      {vetRef !== undefined ? (
        <span class="portrait__vet">
          <span
            ref={vetRef}
            class="ff-vet"
            role="img"
            aria-label={t('ui.common.vet', { n: level, max: VET_MAX })}
            data-component="Vet"
            data-testid="portrait-vet"
            data-level={level}
          >
            {pips}
          </span>
        </span>
      ) : null}
    </div>
  );
}

export interface MeterProps {
  readonly label: string;
  readonly kind: BarKind;
  readonly value: number | ReadonlySignal<number>;
  readonly level?: BarLevel | undefined;
  readonly barClass?: string | undefined;
  /** Right-hand text (plain or a signal bound as text). */
  readonly text: ComponentChildren;
  readonly textClass?: string | undefined;
  readonly textRef?: Ref<HTMLSpanElement> | undefined;
  readonly testId: string;
}

/** Labelled bar row of the unit/factory detail (HP, shield, vet, tap shot, BP). */
export function Meter(props: MeterProps): JSX.Element {
  return (
    <div class="meter" data-testid={props.testId}>
      <span>{props.label}</span>
      <Bar kind={props.kind} value={props.value} level={props.level} class={props.barClass} testId={`${props.testId}-bar`} />
      <span ref={props.textRef ?? null} class={cx('num', props.textClass)} data-testid={`${props.testId}-text`}>
        {props.text}
      </span>
    </div>
  );
}
