/**
 * Status bar: cursor position (WU), map size, marker counts, selection size, store.status and the
 * dirty indicator.
 */
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { EditorStore } from '../../app/store.ts';
import { formatCount } from '../format.ts';
import { S } from '../strings.ts';
import type { PanelIo } from '../types.ts';

/** Cursor text "x 123.4 · z 56.7" (WU, one decimal) or "–". */
export function formatCursor(c: { readonly x: number; readonly z: number } | null): string {
  return c === null ? '–' : `x ${c.x.toFixed(1)} · z ${c.z.toFixed(1)}`;
}

export function StatusBar(props: { readonly store: EditorStore; readonly io: PanelIo }): JSX.Element {
  const { store, io } = props;
  const doc = store.doc.value;
  const revision = store.revision.value;
  const dirty = store.dirty.value;
  const expanded = useMemo(() => store.expandedProps().length, [store, revision]);
  let mass = 0;
  let hydro = 0;
  if (doc !== null) {
    for (const s of doc.spots) {
      if (s.kind === 'mass') mass++;
      else hydro++;
    }
  }
  const selected = store.selection.value.length;

  return (
    <footer class="me-statusbar" data-testid="status-bar">
      <span class="me-stat me-cursor" data-testid="status-cursor" title={S.cursor}>
        {formatCursor(io.cursor.value)}
      </span>
      {doc !== null ? (
        <>
          <span class="me-stat" data-testid="status-size">
            {S.size} {doc.sizeWu}×{doc.sizeWu} WU
          </span>
          <span class="me-stat" data-testid="status-counts">
            {S.starts} {doc.starts.length} · <span class="me-mass">{S.mass} {mass}</span> · <span class="me-hydro">{S.hydro} {hydro}</span> · {S.fields} {doc.fields.length} ·{' '}
            {S.props} {formatCount(expanded)}
            {doc.source.props.length > 0 ? ` + ${formatCount(doc.source.props.length)}` : ''}
          </span>
          {selected > 0 ? (
            <span class="me-stat" data-testid="status-selection">
              {S.selected} {selected}
            </span>
          ) : null}
        </>
      ) : null}
      <span class="me-status-msg" data-testid="status-message" title={store.status.value}>
        {store.status.value}
      </span>
      <span class={`me-dirty${dirty ? ' me-is-dirty' : ''}`} data-testid="status-dirty" data-dirty={String(dirty)}>
        {doc === null ? '' : dirty ? `● ${S.dirty}` : S.clean}
      </span>
    </footer>
  );
}
