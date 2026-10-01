/**
 * Validation panel: counters per severity (click toggles the severity filter) and the issue list.
 * A click on a row selects the issue's markers and focuses the camera on its position.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { EditorStore } from '../../app/store.ts';
import type { EditorIssue } from '../../model/types.ts';
import { formatWu } from '../format.ts';
import { refsIntersect } from '../selection.ts';
import { S, SEVERITY_LABELS, SEVERITY_SHORT } from '../strings.ts';
import type { PanelIo } from '../types.ts';
import { Panel, releaseFocusAfterClick } from './inputs.tsx';

export type Severity = EditorIssue['severity'];
export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];
/** Rows rendered at most (the rest is counted). */
export const MAX_ISSUE_ROWS = 300;

/** Issues ordered by severity (error, warning, info), stable within a severity. */
export function sortIssues(issues: readonly EditorIssue[]): EditorIssue[] {
  const rank = (s: Severity): number => SEVERITIES.indexOf(s);
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => rank(a.issue.severity) - rank(b.issue.severity) || a.i - b.i)
    .map((e) => e.issue);
}

/** Issue count per severity. */
export function countIssues(issues: readonly EditorIssue[]): Record<Severity, number> {
  const c: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const i of issues) c[i.severity]++;
  return c;
}

/** Focus point (Fx raw) of an issue: its position, else the first marker's anchor, else null. */
export function issueFocusPoint(store: EditorStore, issue: EditorIssue): { x: number; z: number } | null {
  if (issue.x !== null && issue.z !== null) return { x: issue.x, z: issue.z };
  const doc = store.doc.peek();
  const r = issue.refs.find((ref) => doc !== null && doc.has(ref));
  return doc !== null && r !== undefined ? doc.positionOf(r) : null;
}

/** Row click: select the issue's markers and focus the camera. */
export function activateIssue(store: EditorStore, io: PanelIo, issue: EditorIssue): void {
  if (issue.refs.length > 0) store.select(issue.refs);
  const p = issueFocusPoint(store, issue);
  if (p !== null) io.focus(p.x, p.z);
}

export function ValidationPanel(props: { readonly store: EditorStore; readonly io: PanelIo }): JSX.Element {
  const { store, io } = props;
  const [hidden, setHidden] = useState<readonly Severity[]>([]);
  const issues = store.issues.value;
  const selection = store.selection.value;
  const counts = countIssues(issues);
  const visible = sortIssues(issues).filter((i) => !hidden.includes(i.severity));
  const shown = visible.slice(0, MAX_ISSUE_ROWS);

  const counters = (
    <div class="me-counters">
      {SEVERITIES.map((s) => {
        const off = hidden.includes(s);
        return (
          <button
            key={s}
            type="button"
            class={`me-counter me-sev-${s}${off ? ' me-off' : ''}`}
            data-testid={`issue-count-${s}`}
            data-count={counts[s]}
            aria-pressed={!off}
            title={`${SEVERITY_LABELS[s]} – ${S.filterTitle}`}
            onClick={(e) => {
              releaseFocusAfterClick(e);
              setHidden(off ? hidden.filter((h) => h !== s) : [...hidden, s]);
            }}
          >
            <span class="me-sev-dot" aria-hidden="true" />
            {counts[s]}
          </button>
        );
      })}
    </div>
  );

  return (
    <Panel title={S.validation} testId="panel-validation" class="me-validation" headerExtra={counters}>
      {issues.length === 0 ? (
        <p class="me-empty me-ok">{store.doc.value === null ? S.noDocument : S.noIssues}</p>
      ) : (
        <ul class="me-issues">
          {shown.map((issue, i) => {
            const active = issue.refs.length > 0 && refsIntersect(issue.refs, selection);
            const pos = issue.x !== null && issue.z !== null ? `${formatWu(issue.x, 1)}, ${formatWu(issue.z, 1)}` : S.mapWide;
            return (
              <li key={`${i}:${issue.code}`}>
                <button
                  type="button"
                  class={`me-issue me-sev-${issue.severity}${active ? ' me-active' : ''}`}
                  data-testid="issue-row"
                  data-code={issue.code}
                  data-severity={issue.severity}
                  title={`${SEVERITY_SHORT[issue.severity]} · ${issue.code}`}
                  onClick={(e) => {
                    releaseFocusAfterClick(e);
                    activateIssue(store, io, issue);
                  }}
                >
                  <span class="me-sev-dot" aria-hidden="true" />
                  <span class="me-issue-text">{issue.message}</span>
                  <span class="me-issue-pos">{pos}</span>
                </button>
              </li>
            );
          })}
          {visible.length > shown.length ? <li class="me-more">{S.issuesHidden(visible.length - shown.length)}</li> : null}
        </ul>
      )}
    </Panel>
  );
}
