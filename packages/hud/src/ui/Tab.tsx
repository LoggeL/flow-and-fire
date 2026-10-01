import type { ComponentChildren, JSX } from 'preact';
import { demoClass } from './Button.tsx';
import type { DemoState } from './Button.tsx';
import { cx } from './cx.ts';

export interface TabsProps {
  /** Accessible name of the tab list (translated). */
  readonly label: string;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
  readonly children?: ComponentChildren | undefined;
}

/** Moves focus between enabled tabs with the arrow keys (ui.md §7.7, §8.5). */
export function focusSibling(list: HTMLElement, selector: string, from: Element | null, key: string): HTMLElement | null {
  const items = Array.from(list.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true',
  );
  if (items.length === 0) return null;
  const i = from ? items.indexOf(from as HTMLElement) : -1;
  let next: HTMLElement | undefined;
  if (key === 'ArrowRight' || key === 'ArrowDown') next = items[(i + 1) % items.length];
  else if (key === 'ArrowLeft' || key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
  else if (key === 'Home') next = items[0];
  else if (key === 'End') next = items[items.length - 1];
  if (!next) return null;
  next.focus();
  return next;
}

const NAV_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

/** Tab list (tech tabs T1–T3, settings, score). */
export function Tabs({ label, class: cls, testId, children }: TabsProps): JSX.Element {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!NAV_KEYS.has(e.key)) return;
    const list = e.currentTarget as HTMLElement;
    if (focusSibling(list, '[role="tab"]', document.activeElement, e.key)) e.preventDefault();
  };
  return (
    <div class={cx('ff-tabs', cls)} role="tablist" aria-label={label} onKeyDown={onKeyDown} data-component="Tabs" data-testid={testId ?? 'tabs'}>
      {children}
    </div>
  );
}

export interface TabProps {
  readonly selected?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly demoState?: DemoState | undefined;
  /** Key hint shown as a small key cap inside the tab. */
  readonly keyHint?: ComponentChildren | undefined;
  /** id of the controlled panel. */
  readonly controls?: string | undefined;
  /** Tooltip/description for disabled tabs (translated reason). */
  readonly title?: string | undefined;
  readonly onSelect?: (() => void) | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
  readonly children?: ComponentChildren | undefined;
}

export function Tab(props: TabProps): JSX.Element {
  const { selected = false, disabled = false } = props;
  return (
    <button
      type="button"
      role="tab"
      class={cx('ff-tab', selected && 'is-selected', disabled && 'is-disabled', demoClass(props.demoState), props.class)}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      aria-controls={props.controls}
      title={props.title}
      tabIndex={selected ? 0 : -1}
      onClick={disabled ? undefined : props.onSelect}
      data-component="Tab"
      data-testid={props.testId ?? 'tab'}
    >
      {props.children}
      {props.keyHint ? <span class="ff-key">{props.keyHint}</span> : null}
    </button>
  );
}
