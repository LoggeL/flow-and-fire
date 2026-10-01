/**
 * Help overlay with every shortcut and mouse action. Opens with "?" or the help button, closes with
 * "?", Esc, the close button or a click on the backdrop.
 */
import type { Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { HELP_KEYS, HELP_MOUSE, S, TOOL_HINTS, TOOL_LABELS } from '../strings.ts';
import { TOOL_ORDER } from './ToolPalette.tsx';

function Table(props: { readonly rows: readonly (readonly [string, string])[] }): JSX.Element {
  return (
    <table class="me-help-table">
      <tbody>
        {props.rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">
              <kbd class="me-kbd">{k}</kbd>
            </th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HelpOverlay(props: { readonly open: Signal<boolean> }): JSX.Element | null {
  const { open } = props;
  if (!open.value) return null;
  const tools = TOOL_ORDER.map((id, i): readonly [string, string] => [`${i + 1} · ${TOOL_LABELS[id]}`, TOOL_HINTS[id]]);
  return (
    <div
      class="me-help-backdrop"
      data-testid="help-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) open.value = false;
      }}
    >
      <div class="me-help" role="dialog" aria-modal="true" aria-label={S.helpHeading}>
        <header class="me-help-head">
          <h2>{S.helpHeading}</h2>
          <button type="button" class="me-btn" data-testid="btn-help-close" onClick={() => (open.value = false)}>
            {S.helpClose}
          </button>
        </header>
        <div class="me-help-cols">
          <section>
            <h3>{S.helpKeys}</h3>
            <Table rows={HELP_KEYS} />
            <h3>{S.helpMouse}</h3>
            <Table rows={HELP_MOUSE} />
          </section>
          <section>
            <h3>{S.helpTools}</h3>
            <Table rows={tools} />
          </section>
        </div>
        <p class="me-hint">{S.helpFooter}</p>
      </div>
    </div>
  );
}

/** True if a keyboard event targets a text field (shortcuts are ignored there). */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Global keys of the panels: "?" toggles the help, Esc closes it (and is then consumed so the
 * controller does not also clear the selection). Returns the uninstall function.
 */
export function installHelpKeys(open: Signal<boolean>, target: Window = window): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
    if (e.key === '?') {
      e.preventDefault();
      open.value = !open.value;
    } else if (e.key === 'Escape' && open.value) {
      e.preventDefault();
      e.stopImmediatePropagation();
      open.value = false;
    }
  };
  // Capture phase: runs before the controller's window listener (bubble phase).
  target.addEventListener('keydown', onKey, true);
  return () => target.removeEventListener('keydown', onKey, true);
}
