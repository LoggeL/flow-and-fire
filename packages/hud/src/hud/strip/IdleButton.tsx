import { useComputed } from '@preact/signals';
import type { JSX } from 'preact';
import { t, tn } from '../../i18n/t.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { idleBadgeText } from '../../model/strip.ts';
import { demoClass } from '../../ui/Button.tsx';
import type { DemoState } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { keyLabel } from '../../ui/keys.ts';
import { LineIcon } from '../../ui/LineIcon.tsx';

export interface IdleButtonProps {
  readonly demoState?: DemoState | undefined;
  readonly testId?: string | undefined;
}

/** Accessible name/tooltip of the idle button with both counts (ui.md §5.9). */
export function idleLabel(engineers: number, factories: number): string {
  const count = engineers > 0 ? tn('ui.strip.idle.engineers', engineers) : t('ui.strip.idle.none');
  const fac = factories > 0 ? tn('ui.strip.idle.factories', factories) : t('ui.strip.idle.factoriesNone');
  return `${t('ui.strip.idle.engineerLabel', { count })} · ${fac}`;
}

/**
 * Idle engineer button (ui.md §5.9, C14): ember count badge only when > 0 (1 Hz). Click = next idle
 * engineer (selectIdleEngineer(false)), Shift+click = all idle engineers, right click = next idle factory
 * (the „,“ key; the second control shares the button because the strip slot over the minimap is full).
 */
export function IdleButton(props: IdleButtonProps): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const strip = model.strip;
  const badge = useComputed(() => idleBadgeText(strip.idleEngineers.value));
  const label = useComputed(() => idleLabel(strip.idleEngineers.value, strip.idleFactories.value));
  const layout = model.keyboardLayout.value;
  const zero = badge.value === '';
  return (
    <div class="idle" data-component="IdleButton" data-testid={props.testId ?? 'idle-button'} data-count={strip.idleEngineers.value}>
      <button
        type="button"
        class={cx('ff-order', zero && 'is-idle-zero', demoClass(props.demoState))}
        aria-label={label.value}
        title={label.value}
        data-testid="idle-engineer"
        onClick={(e) => commands.selectIdleEngineer(e.shiftKey)}
        onContextMenu={(e) => {
          e.preventDefault();
          commands.selectIdleFactory();
        }}
      >
        <LineIcon name="idle" />
        <span class="ff-order__key">{keyLabel('Period', layout)}</span>
      </button>
      {zero ? null : (
        <span class="idle__n num" aria-hidden="true" data-testid="idle-count">
          {badge}
        </span>
      )}
    </div>
  );
}
