/**
 * Tool palette: the 7 editor tools in ToolId order with their hotkeys 1–7 (the keys themselves are
 * handled by the controller's keymap); the active tool is highlighted.
 */
import type { JSX } from 'preact';
import type { EditorStore } from '../../app/store.ts';
import type { ToolId } from '../../model/types.ts';
import { S, TOOL_HINTS, TOOL_LABELS } from '../strings.ts';
import { Panel, releaseFocusAfterClick } from './inputs.tsx';

/** Tools in hotkey order (Digit1..Digit7). */
export const TOOL_ORDER: readonly ToolId[] = ['select', 'start', 'mass', 'hydro', 'fieldCircle', 'fieldPolygon', 'delete'];

/** data-testid of each tool button. */
export const TOOL_TEST_IDS: Readonly<Record<ToolId, string>> = {
  select: 'tool-select',
  start: 'tool-start',
  mass: 'tool-mass',
  hydro: 'tool-hydro',
  fieldCircle: 'tool-field-circle',
  fieldPolygon: 'tool-field-polygon',
  delete: 'tool-delete',
};

const TOOL_ICONS: Readonly<Record<ToolId, string>> = {
  select: '⌖',
  start: '★',
  mass: '◆',
  hydro: '◈',
  fieldCircle: '◯',
  fieldPolygon: '⬠',
  delete: '✕',
};

export function ToolPalette(props: { readonly store: EditorStore }): JSX.Element {
  const { store } = props;
  const active = store.tool.value;
  return (
    <Panel title={S.tools} testId="panel-tools" class="me-tools">
      <div class="me-tool-list" role="toolbar" aria-label={S.tools}>
        {TOOL_ORDER.map((id, i) => (
          <button
            key={id}
            type="button"
            class={`me-tool me-tool-${id}${active === id ? ' me-active' : ''}`}
            data-testid={TOOL_TEST_IDS[id]}
            data-tool={id}
            aria-pressed={active === id}
            title={`${TOOL_LABELS[id]} (${i + 1}) – ${TOOL_HINTS[id]}`}
            onClick={(e) => {
              releaseFocusAfterClick(e);
              store.tool.value = id;
            }}
          >
            <span class="me-tool-icon" aria-hidden="true">
              {TOOL_ICONS[id]}
            </span>
            <span class="me-tool-label">{TOOL_LABELS[id]}</span>
            <kbd class="me-kbd">{i + 1}</kbd>
          </button>
        ))}
      </div>
      <p class="me-hint" data-testid="tool-hint">
        {TOOL_HINTS[active]}
      </p>
    </Panel>
  );
}
