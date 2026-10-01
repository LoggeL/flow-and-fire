/**
 * Form controls of the panels: a validated text/number input that commits on change or Enter as
 * one store command, and small layout helpers.
 *
 * ValueInput keeps the user's text as a draft while typing and validates it live (red + tooltip
 * when invalid). Enter or the change event (leaving the field) commits a valid value once — the
 * draft lives in a ref, so Enter followed by the browser's change event does not commit twice —
 * and `isCurrent` suppresses no-op commands. Esc discards the draft. An invalid value is never
 * committed. When the model value changes (undo, another selection), the draft is dropped.
 */
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ParseResult } from '../format.ts';

export interface ValueInputProps<T> {
  readonly testId: string;
  readonly label: string;
  /** Formatted model value. */
  readonly value: string;
  readonly parse: (text: string) => ParseResult<T>;
  readonly onCommit: (value: T) => void;
  /** True if `value` equals the live model value (no command is issued then). */
  readonly isCurrent?: (value: T) => boolean;
  readonly title?: string;
  readonly placeholder?: string;
  readonly suffix?: string;
  readonly inputMode?: 'decimal' | 'numeric' | 'text';
  readonly wide?: boolean;
  readonly disabled?: boolean;
}

export function ValueInput<T>(props: ValueInputProps<T>): JSX.Element {
  const { testId, label, value, parse, onCommit, isCurrent, title, placeholder, suffix, inputMode = 'decimal', wide = false, disabled = false } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);

  useEffect(() => {
    draftRef.current = null;
    setDraft(null);
    setError(null);
  }, [value]);

  const update = (text: string | null): void => {
    draftRef.current = text;
    setDraft(text);
  };

  const commit = (): void => {
    const text = draftRef.current;
    if (text === null) return;
    const r = parse(text);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    update(null);
    if (isCurrent === undefined || !isCurrent(r.value)) onCommit(r.value);
  };

  const onInput = (e: JSX.TargetedEvent<HTMLInputElement>): void => {
    const text = e.currentTarget.value;
    update(text);
    const r = parse(text);
    setError(r.ok ? null : r.error);
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      update(null);
      setError(null);
    }
  };

  const invalid = error !== null;
  return (
    <label class={`me-row${wide ? ' me-row-wide' : ''}`} title={title}>
      <span class="me-row-label">{label}</span>
      <span class="me-row-control">
        <input
          type="text"
          class={`me-input${invalid ? ' me-invalid' : ''}`}
          data-testid={testId}
          value={draft ?? value}
          inputMode={inputMode}
          spellcheck={false}
          autocomplete="off"
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={invalid}
          title={error ?? title}
          onInput={onInput}
          onChange={commit}
          onKeyDown={onKeyDown}
        />
        {suffix !== undefined ? <span class="me-suffix">{suffix}</span> : null}
      </span>
      {invalid ? <span class="me-error" role="alert">{error}</span> : null}
    </label>
  );
}

/** Label + arbitrary control in the panel grid. */
export function Row(props: { readonly label: string; readonly children: ComponentChildren; readonly title?: string }): JSX.Element {
  return (
    <div class="me-row" title={props.title}>
      <span class="me-row-label">{props.label}</span>
      <span class="me-row-control">{props.children}</span>
    </div>
  );
}

/** Label + read-only value. */
export function InfoRow(props: { readonly label: string; readonly value: ComponentChildren; readonly testId?: string }): JSX.Element {
  return (
    <div class="me-row">
      <span class="me-row-label">{props.label}</span>
      <span class="me-row-value" data-testid={props.testId}>
        {props.value}
      </span>
    </div>
  );
}

/** Removes the focus from a clicked control so the editor's keyboard shortcuts keep working. */
export function releaseFocus(e: Event): void {
  const t = e.currentTarget;
  if (t instanceof HTMLElement) t.blur();
}

/** Mouse clicks release the focus (Enter/Space would otherwise re-trigger the button later). */
export function releaseFocusAfterClick(e: MouseEvent): void {
  if (e.detail > 0) releaseFocus(e);
}

/** Panel frame with a heading. */
export function Panel(props: {
  readonly title: string;
  readonly testId?: string;
  readonly class?: string;
  readonly headerExtra?: ComponentChildren;
  readonly children: ComponentChildren;
}): JSX.Element {
  return (
    <section class={`me-panel${props.class !== undefined ? ` ${props.class}` : ''}`} data-testid={props.testId}>
      <header class="me-panel-head">
        <h2>{props.title}</h2>
        {props.headerExtra}
      </header>
      <div class="me-panel-body">{props.children}</div>
    </section>
  );
}
