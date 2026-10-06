import type { ComponentChildren, JSX } from 'preact';
import type { SelectionFilterKind } from '../../commands/strip.ts';
import { t } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { SELECTION_FILTERS } from '../../model/strip.ts';
import { demoClass } from '../../ui/Button.tsx';
import type { DemoState } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import type { LineIconName } from '../../ui/icons.ts';
import { keyLabel } from '../../ui/keys.ts';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { IdleButton } from './IdleButton.tsx';

export const FILTER_ICON: Readonly<Record<SelectionFilterKind, LineIconName>> = {
  land: 'f_land',
  air: 'f_air',
  factories: 'f_fac',
  engineers: 'f_eng',
};

export const FILTER_TEXT: Readonly<Record<SelectionFilterKind, MsgKey>> = {
  land: 'ui.strip.filter.land',
  air: 'ui.strip.filter.air',
  factories: 'ui.strip.filter.factories',
  engineers: 'ui.strip.filter.engineers',
};

export interface SelectionFilterProps {
  /** Static demo state for one filter (gallery). */
  readonly demo?: { readonly kind: SelectionFilterKind; readonly state: DemoState } | undefined;
  /** Idle button demo state (gallery). */
  readonly idleDemo?: DemoState | undefined;
  /** Render the idle button at the right end (default true, as in the mockup). */
  readonly withIdle?: boolean | undefined;
  readonly testId?: string | undefined;
  readonly children?: ComponentChildren | undefined;
}

/**
 * Selection filters over the minimap (ui.md §5.9, C14): four 34-px buttons – all land (F2), all air (F3),
 * all factories (F4), all engineers (F6); with Shift they filter the current selection (filter(kind, shift)).
 * The idle engineer button sits at the right end of the same row.
 */
export function SelectionFilter(props: SelectionFilterProps): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const layout = model.keyboardLayout.value;
  return (
    <div
      class="filters"
      role="toolbar"
      aria-label={t('ui.strip.filters')}
      data-component="SelectionFilter"
      data-panel="filters"
      data-testid={props.testId ?? 'selection-filter'}
    >
      {SELECTION_FILTERS.map((f) => {
        const key = keyLabel(f.code, layout);
        const label = t('ui.strip.filter.label', { name: t(FILTER_TEXT[f.kind]), key });
        return (
          <button
            key={f.kind}
            type="button"
            class={cx('ff-order', props.demo?.kind === f.kind && demoClass(props.demo.state))}
            aria-label={label}
            title={label}
            data-filter={f.kind}
            data-testid={`filter-${f.kind}`}
            onClick={(e) => commands.filter(f.kind, e.shiftKey)}
          >
            <LineIcon name={FILTER_ICON[f.kind]} />
            <span class="ff-order__key">{key}</span>
          </button>
        );
      })}
      {props.withIdle === false ? null : <IdleButton demoState={props.idleDemo} />}
      {props.children}
    </div>
  );
}
