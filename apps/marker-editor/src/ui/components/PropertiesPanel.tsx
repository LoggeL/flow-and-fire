/**
 * Properties panel: edits the selected start (army, x/z), spot (x/z), prop field (name, kind,
 * blueprint entries, density, seed, scale, slope, dry-only, reclaim, circle centre/radius) or
 * polygon vertex (x/z); shows a summary for a multi-selection. Every commit is one undo step:
 * updateField / setStartArmy / setFieldRadius / moveVertex, and moves go through
 * beginGesture + moveSelectionBy + endGesture.
 */
import type { MapPropField, PropFieldKind } from '@faf/formats';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { EditorStore } from '../../app/store.ts';
import type { EditorDocument } from '../../model/document.ts';
import type { MarkerRef } from '../../model/types.ts';
import {
  formatCount,
  formatEntries,
  formatMilli,
  formatPercent,
  formatSeed,
  formatWu,
  nextSeed,
  parseEntries,
  parseFieldName,
  parseIntRange,
  parseMilli,
  parsePercent,
  parseSeed,
  parseWuToRaw,
  type ParseResult,
} from '../format.ts';
import { fieldStats, panelFocus, type SelectionSummary } from '../selection.ts';
import { E, FIELD_KIND_LABELS, S, SPOT_KIND_LABELS } from '../strings.ts';
import { InfoRow, Panel, releaseFocus, releaseFocusAfterClick, Row, ValueInput } from './inputs.tsx';

const FIELD_KINDS: readonly PropFieldKind[] = ['tree', 'rock', 'wreck'];
const ARMIES: readonly number[] = Array.from({ length: 16 }, (_, i) => i);
const MAX_DENSITY = 4096;
const U16_MAX = 0xffff;

/** Moves the marker `ref` so that its anchor lands on (x, z) (Fx raw) as one undo step. */
export function moveMarkerTo(store: EditorStore, ref: MarkerRef, x: number, z: number): void {
  const doc = store.doc.peek();
  if (doc === null || !doc.has(ref)) return;
  const cur = doc.positionOf(ref);
  if (cur.x === x && cur.z === z) return;
  store.select([ref]);
  store.beginGesture();
  try {
    store.moveSelectionBy(x - cur.x, z - cur.z);
  } finally {
    store.endGesture();
  }
}

/** x/z inputs (WU) of a marker anchor; commits through `onMove(x, z)` in Fx raw. */
function PositionInputs(props: { readonly doc: EditorDocument; readonly x: number; readonly z: number; readonly onMove: (x: number, z: number) => void }): JSX.Element {
  const { doc, x, z, onMove } = props;
  const parse = (t: string): ParseResult<number> => parseWuToRaw(t, doc.maxRaw);
  return (
    <>
      <ValueInput testId="marker-x" label={S.x} value={formatWu(x)} parse={parse} isCurrent={(v) => v === x} onCommit={(v) => onMove(v, z)} />
      <ValueInput testId="marker-z" label={S.z} value={formatWu(z)} parse={parse} isCurrent={(v) => v === z} onCommit={(v) => onMove(x, v)} />
    </>
  );
}

function StartEditor(props: { readonly store: EditorStore; readonly doc: EditorDocument; readonly index: number }): JSX.Element {
  const { store, doc, index } = props;
  const s = doc.starts[index]!;
  const ref: MarkerRef = { type: 'start', index };
  return (
    <div class="me-editor" data-kind="start">
      <h3 class="me-subhead">
        {S.start} {s.army + 1}
      </h3>
      <Row label={S.army}>
        <select
          class="me-select"
          data-testid="start-army"
          value={String(s.army)}
          onChange={(e) => {
            const army = Number(e.currentTarget.value);
            releaseFocus(e);
            if (Number.isInteger(army) && army !== s.army) store.setStartArmy(index, army);
          }}
        >
          {ARMIES.map((a) => {
            const taken = a !== s.army && doc.starts.some((o) => o.army === a);
            return (
              <option key={a} value={String(a)}>
                {S.armyOption(a)}
                {taken ? ` (${S.armyTaken})` : ''}
              </option>
            );
          })}
        </select>
      </Row>
      <PositionInputs doc={doc} x={s.x} z={s.z} onMove={(x, z) => moveMarkerTo(store, ref, x, z)} />
    </div>
  );
}

function SpotEditor(props: { readonly store: EditorStore; readonly doc: EditorDocument; readonly index: number }): JSX.Element {
  const { store, doc, index } = props;
  const s = doc.spots[index]!;
  const ref: MarkerRef = { type: 'spot', index };
  return (
    <div class="me-editor" data-kind="spot">
      <h3 class="me-subhead">
        {S.spot} {index + 1}
      </h3>
      <InfoRow label={S.kind} value={<span class={`me-spot-kind me-spot-${s.kind}`}>{SPOT_KIND_LABELS[s.kind]}</span>} testId="spot-kind" />
      <PositionInputs doc={doc} x={s.x} z={s.z} onMove={(x, z) => moveMarkerTo(store, ref, x, z)} />
    </div>
  );
}

function FieldEditor(props: { readonly store: EditorStore; readonly doc: EditorDocument; readonly index: number; readonly vertex: number | null }): JSX.Element {
  const { store, doc, index, vertex } = props;
  const f = doc.fields[index]!;
  const revision = store.revision.value;
  const stats = useMemo(() => fieldStats(store.expandedProps(), [index]), [store, revision, index]);
  /** Live field (the inputs compare against it, not against the rendered snapshot). */
  const live = (): MapPropField | undefined => store.doc.peek()?.fields[index];
  const update = (patch: Partial<Omit<MapPropField, 'shape'>>): void => store.updateField(index, patch);
  const sh = f.shape;

  const parseScaleMin = (t: string): ParseResult<number> => {
    const r = parsePercent(t, 1, U16_MAX);
    if (r.ok && r.value > (live()?.scaleMaxPermille ?? U16_MAX)) return { ok: false, error: E.scaleOrder };
    return r;
  };
  const parseScaleMax = (t: string): ParseResult<number> => {
    const r = parsePercent(t, 1, U16_MAX);
    if (r.ok && r.value < (live()?.scaleMinPermille ?? 1)) return { ok: false, error: E.scaleOrder };
    return r;
  };

  return (
    <div class="me-editor" data-kind="field">
      <h3 class="me-subhead">
        {S.field} {index + 1}
        <span class="me-subhead-note">{sh.kind === 'circle' ? S.circleShape : S.polygonPoints(sh.points.length)}</span>
      </h3>
      {vertex !== null && sh.kind === 'polygon' && sh.points[vertex] !== undefined ? (
        <div class="me-vertex">
          <div class="me-note">{S.vertexOf(index, vertex)}</div>
          <PositionInputs doc={doc} x={sh.points[vertex].x} z={sh.points[vertex].z} onMove={(x, z) => store.moveVertex(index, vertex, x, z)} />
        </div>
      ) : null}
      {sh.kind === 'circle' ? (
        <>
          <PositionInputs doc={doc} x={sh.x} z={sh.z} onMove={(x, z) => moveMarkerTo(store, { type: 'field', index }, x, z)} />
          <ValueInput
            testId="field-radius"
            label={S.radius}
            value={formatWu(sh.r)}
            parse={(t) => {
              const r = parseWuToRaw(t, doc.maxRaw);
              return r.ok && r.value < 4096 ? { ok: false, error: E.range('1', formatWu(doc.maxRaw)) } : r;
            }}
            isCurrent={(v) => {
              const s2 = live()?.shape;
              return s2?.kind === 'circle' && s2.r === v;
            }}
            onCommit={(v) => store.setFieldRadius(index, v)}
          />
        </>
      ) : null}
      <ValueInput testId="field-name" label={S.name} value={f.name} parse={parseFieldName} inputMode="text" isCurrent={(v) => live()?.name === v} onCommit={(name) => update({ name })} />
      <Row label={S.kind}>
        <select
          class="me-select"
          data-testid="field-kind"
          value={f.kind}
          onChange={(e) => {
            const v = e.currentTarget.value;
            releaseFocus(e);
            const kind = FIELD_KINDS.find((k) => k === v);
            if (kind !== undefined && kind !== live()?.kind) update({ kind });
          }}
        >
          {FIELD_KINDS.map((k) => (
            <option key={k} value={k}>
              {FIELD_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </Row>
      <ValueInput
        testId="field-ids"
        label={S.ids}
        value={formatEntries(f.entries)}
        parse={parseEntries}
        inputMode="text"
        wide
        placeholder={S.idsHint}
        title={S.idsHint}
        isCurrent={(v) => {
          const cur = live();
          return cur !== undefined && formatEntries(cur.entries) === formatEntries(v);
        }}
        onCommit={(entries) => update({ entries })}
      />
      <ValueInput
        testId="field-density"
        label={S.density}
        value={String(f.densityPerKWu2)}
        parse={(t) => parseIntRange(t, 1, MAX_DENSITY)}
        inputMode="numeric"
        isCurrent={(v) => live()?.densityPerKWu2 === v}
        onCommit={(densityPerKWu2) => update({ densityPerKWu2 })}
      />
      <div class="me-seed">
        <ValueInput testId="field-seed" label={S.seed} value={formatSeed(f.seed)} parse={parseSeed} inputMode="numeric" isCurrent={(v) => live()?.seed === v} onCommit={(seed) => update({ seed })} />
        <button
          type="button"
          class="me-btn me-btn-small"
          data-testid="btn-field-reseed"
          title={S.reseedTitle}
          onClick={(e) => {
            releaseFocusAfterClick(e);
            const cur = live();
            if (cur !== undefined) update({ seed: nextSeed(cur.seed, store.revision.peek(), index) });
          }}
        >
          ⟳ {S.reseed}
        </button>
      </div>
      <ValueInput
        testId="field-scale-min"
        label={S.scaleMin}
        value={formatPercent(f.scaleMinPermille)}
        parse={parseScaleMin}
        suffix="%"
        isCurrent={(v) => live()?.scaleMinPermille === v}
        onCommit={(scaleMinPermille) => update({ scaleMinPermille })}
      />
      <ValueInput
        testId="field-scale-max"
        label={S.scaleMax}
        value={formatPercent(f.scaleMaxPermille)}
        parse={parseScaleMax}
        suffix="%"
        isCurrent={(v) => live()?.scaleMaxPermille === v}
        onCommit={(scaleMaxPermille) => update({ scaleMaxPermille })}
      />
      <ValueInput
        testId="field-max-slope"
        label={S.maxSlope}
        title={S.maxSlopeTitle}
        value={String(f.maxSlopePermille)}
        parse={(t) => parseIntRange(t.replace(/\s*‰\s*$/, ''), 0, U16_MAX)}
        suffix="‰"
        inputMode="numeric"
        isCurrent={(v) => live()?.maxSlopePermille === v}
        onCommit={(maxSlopePermille) => update({ maxSlopePermille })}
      />
      <label class="me-check">
        <input
          type="checkbox"
          data-testid="field-dry-only"
          checked={f.dryOnly}
          onChange={(e) => {
            const dryOnly = e.currentTarget.checked;
            releaseFocus(e);
            if (live()?.dryOnly !== dryOnly) update({ dryOnly });
          }}
        />
        <span>{S.dryOnly}</span>
      </label>
      <ValueInput
        testId="field-reclaim-mass"
        label={S.reclaimMass}
        value={formatMilli(f.reclaimMassMilli)}
        parse={parseMilli}
        suffix="M"
        isCurrent={(v) => live()?.reclaimMassMilli === v}
        onCommit={(reclaimMassMilli) => update({ reclaimMassMilli })}
      />
      <ValueInput
        testId="field-reclaim-energy"
        label={S.reclaimEnergy}
        value={formatMilli(f.reclaimEnergyMilli)}
        parse={parseMilli}
        suffix="E"
        isCurrent={(v) => live()?.reclaimEnergyMilli === v}
        onCommit={(reclaimEnergyMilli) => update({ reclaimEnergyMilli })}
      />
      <div class="me-stats">
        <InfoRow label={S.expanded} value={formatCount(stats.count)} testId="field-count" />
        <InfoRow
          label={S.reclaimTotal}
          value={
            <span data-testid="field-reclaim-total">
              <span class="me-mass">{formatMilli(stats.massMilli)} M</span> · <span class="me-energy">{formatMilli(stats.energyMilli)} E</span>
            </span>
          }
        />
      </div>
    </div>
  );
}

function MultiSummary(props: { readonly store: EditorStore; readonly summary: SelectionSummary }): JSX.Element {
  const { store, summary } = props;
  const revision = store.revision.value;
  const stats = useMemo(() => fieldStats(store.expandedProps(), summary.fieldIndices), [store, revision, summary.fieldIndices.join(',')]);
  const parts: string[] = [];
  if (summary.starts > 0) parts.push(S.multiStarts(summary.starts));
  if (summary.mass + summary.hydro > 0) parts.push(S.multiSpots(summary.mass, summary.hydro));
  if (summary.fields > 0) parts.push(S.multiFields(summary.fields));
  if (summary.vertices > 0) parts.push(S.multiVertices(summary.vertices));
  return (
    <div class="me-editor" data-kind="multi" data-testid="selection-summary">
      <h3 class="me-subhead">{S.multiTitle(summary.objects)}</h3>
      <ul class="me-summary">
        {parts.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {summary.fields > 0 ? (
        <div class="me-stats">
          <InfoRow label={S.expanded} value={formatCount(stats.count)} testId="field-count" />
          <InfoRow
            label={S.reclaimTotal}
            value={
              <span data-testid="field-reclaim-total">
                <span class="me-mass">{formatMilli(stats.massMilli)} M</span> · <span class="me-energy">{formatMilli(stats.energyMilli)} E</span>
              </span>
            }
          />
        </div>
      ) : null}
      <p class="me-hint">{S.multiHint}</p>
    </div>
  );
}

export function PropertiesPanel(props: { readonly store: EditorStore }): JSX.Element {
  const { store } = props;
  const doc = store.doc.value;
  const focus = panelFocus(doc, store.selection.value);
  let body: JSX.Element;
  if (doc === null) {
    body = <p class="me-empty">{S.noDocument}</p>;
  } else if (focus.kind === 'start') {
    body = <StartEditor key={`s${focus.index}`} store={store} doc={doc} index={focus.index} />;
  } else if (focus.kind === 'spot') {
    body = <SpotEditor key={`p${focus.index}`} store={store} doc={doc} index={focus.index} />;
  } else if (focus.kind === 'field') {
    body = <FieldEditor key={`f${focus.index}:${focus.vertex ?? ''}`} store={store} doc={doc} index={focus.index} vertex={focus.vertex} />;
  } else if (focus.kind === 'multi') {
    body = <MultiSummary store={store} summary={focus.summary} />;
  } else {
    body = (
      <div class="me-editor" data-kind="none">
        <p class="me-empty">{S.noSelection}</p>
        <InfoRow label={S.mapInfo} value={`${doc.name} · ${doc.sizeWu}×${doc.sizeWu} WU`} />
      </div>
    );
  }
  return (
    <Panel title={S.properties} testId="panel-properties" class="me-properties">
      {body}
    </Panel>
  );
}
