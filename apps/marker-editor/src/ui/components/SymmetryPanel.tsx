/**
 * Symmetry panel: mode (store.symmetry), half to keep, "Symmetrisieren" (one undo step), live
 * symmetry, height grid and snap step.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { EditorStore } from '../../app/store.ts';
import type { SymmetryMode } from '../../model/types.ts';
import { KEEP_HALF_LABELS, S, SYMMETRY_LABELS } from '../strings.ts';
import type { PanelIo } from '../types.ts';
import { Panel, releaseFocus, releaseFocusAfterClick, Row } from './inputs.tsx';

export const SYMMETRY_ORDER: readonly SymmetryMode[] = ['none', 'point', 'mirrorX', 'mirrorZ', 'diagonal', 'antiDiagonal'];

/** Snap steps offered (Fx raw; 0 = integer raw only). */
export const SNAP_STEPS: readonly { readonly raw: number; readonly label: string }[] = [
  { raw: 0, label: S.snapOff },
  { raw: 1024, label: '0.25 WU' },
  { raw: 2048, label: '0.5 WU' },
  { raw: 4096, label: '1 WU' },
  { raw: 8192, label: '2 WU' },
  { raw: 16384, label: '4 WU' },
];

function isSymmetryMode(v: string): v is SymmetryMode {
  return (SYMMETRY_ORDER as readonly string[]).includes(v);
}

export function SymmetryPanel(props: { readonly store: EditorStore; readonly io: PanelIo }): JSX.Element {
  const { store, io } = props;
  const [keep, setKeep] = useState<'a' | 'b'>('a');
  const mode = store.symmetry.value;
  const hasDoc = store.doc.value !== null;
  const halves = KEEP_HALF_LABELS[mode];
  const snap = store.snapRaw.value;
  const snapOptions = SNAP_STEPS.some((s) => s.raw === snap) ? SNAP_STEPS : [...SNAP_STEPS, { raw: snap, label: `${snap / 4096} WU` }];

  return (
    <Panel title={S.symmetry} testId="panel-symmetry" class="me-symmetry">
      <Row label={S.symmetryMode}>
        <select
          class="me-select"
          data-testid="select-symmetry"
          value={mode}
          onChange={(e) => {
            const v = e.currentTarget.value;
            releaseFocus(e);
            if (isSymmetryMode(v)) store.symmetry.value = v;
          }}
        >
          {SYMMETRY_ORDER.map((m) => (
            <option key={m} value={m}>
              {SYMMETRY_LABELS[m]}
            </option>
          ))}
        </select>
      </Row>
      <Row label={S.keepHalf}>
        <select
          class="me-select"
          data-testid="select-keep-half"
          value={keep}
          disabled={mode === 'none'}
          onChange={(e) => {
            const v = e.currentTarget.value;
            releaseFocus(e);
            setKeep(v === 'b' ? 'b' : 'a');
          }}
        >
          <option value="a">{halves.a}</option>
          <option value="b">{halves.b}</option>
        </select>
      </Row>
      <button
        type="button"
        class="me-btn me-btn-block"
        data-testid="btn-symmetrize"
        title={S.symmetrizeTitle}
        disabled={!hasDoc || mode === 'none'}
        onClick={(e) => {
          releaseFocusAfterClick(e);
          store.symmetrize(mode, keep);
        }}
      >
        {S.symmetrize}
      </button>
      <label class="me-check" title={S.liveSymmetryTitle}>
        <input
          type="checkbox"
          data-testid="chk-live-symmetry"
          checked={store.liveSymmetry.value}
          onChange={(e) => {
            store.liveSymmetry.value = e.currentTarget.checked;
            releaseFocus(e);
          }}
        />
        <span>{S.liveSymmetry}</span>
      </label>
      <label class="me-check" title={S.gridTitle}>
        <input
          type="checkbox"
          data-testid="chk-grid"
          checked={io.gridVisible.value}
          onChange={(e) => {
            io.gridVisible.value = e.currentTarget.checked;
            releaseFocus(e);
          }}
        />
        <span>{S.grid}</span>
      </label>
      <Row label={S.snap}>
        <select
          class="me-select"
          data-testid="select-snap"
          value={String(snap)}
          onChange={(e) => {
            const v = Number(e.currentTarget.value);
            releaseFocus(e);
            if (Number.isInteger(v) && v >= 0) store.snapRaw.value = v;
          }}
        >
          {snapOptions.map((s) => (
            <option key={s.raw} value={String(s.raw)}>
              {s.label}
            </option>
          ))}
        </select>
      </Row>
    </Panel>
  );
}
