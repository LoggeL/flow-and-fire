import type { ComponentChildren, JSX } from 'preact';
import { cx } from './cx.ts';
import { Key } from './Key.tsx';
import { ResourceGlyph } from './ResourceGlyph.tsx';

export interface TooltipStat {
  /** Translated label (rendered small caps). */
  readonly label: string;
  /** Formatted value. */
  readonly value: string;
  /** Optional second line (e.g. "bei BP 10"). */
  readonly sub?: string | undefined;
}

export interface TooltipCost {
  /** Formatted mass cost. */
  readonly mass?: string | undefined;
  /** Formatted energy cost. */
  readonly energy?: string | undefined;
  /** Flow demand line ("≈ 6,5 M/s · 33 E/s Flow"). */
  readonly flow?: ComponentChildren | undefined;
  /** Flow demand exceeds the current net (shown in warning colour, ui.md §5.6). */
  readonly flowWarn?: boolean | undefined;
}

export interface TooltipFrameProps {
  readonly icon?: ComponentChildren | undefined;
  readonly name: ComponentChildren;
  readonly role?: ComponentChildren | undefined;
  readonly keyHint?: ComponentChildren | undefined;
  readonly cost?: TooltipCost | undefined;
  /** Up to 6 values in the 3 × 2 grid. */
  readonly stats?: readonly TooltipStat[] | undefined;
  readonly body?: ComponentChildren | undefined;
  /** Adjacency box (E11, verdigris): label + text. */
  readonly adjacency?: { readonly label: ComponentChildren; readonly text: ComponentChildren } | undefined;
  readonly foot?: ComponentChildren | undefined;
  readonly id?: string | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Tooltip layout (ui.md §5.12): head, cost, 3 × 2 value grid, description, adjacency, foot. Content via props. */
export function TooltipFrame(props: TooltipFrameProps): JSX.Element {
  const { cost, stats, adjacency } = props;
  return (
    <div id={props.id} class={cx('ff-tip', props.class)} role="tooltip" data-component="TooltipFrame" data-testid={props.testId ?? 'tooltip-frame'}>
      <div class="ff-tip__head">
        {props.icon ?? <span />}
        <div>
          <div class="ff-tip__name" data-fit="">
            {props.name}
          </div>
          {props.role ? <div class="ff-tip__role">{props.role}</div> : null}
        </div>
        {props.keyHint ? <Key tone="ember">{props.keyHint}</Key> : <span />}
      </div>
      {cost ? (
        <div class="ff-tip__cost">
          {cost.mass !== undefined ? (
            <span class="ff-tip__mass">
              <ResourceGlyph kind="mass" />
              <b class="num">{cost.mass}</b>
            </span>
          ) : null}
          {cost.energy !== undefined ? (
            <span class="ff-tip__energy">
              <ResourceGlyph kind="energy" />
              <b class="num">{cost.energy}</b>
            </span>
          ) : null}
          {cost.flow ? <span class={cx('ff-dim', 'num', 'ff-tip__flow', cost.flowWarn && 'is-warn')}>{cost.flow}</span> : null}
        </div>
      ) : null}
      {stats && stats.length > 0 ? (
        <div class="ff-tip__grid">
          {stats.slice(0, 6).map((s, i) => (
            <div key={i}>
              <small>{s.label}</small>
              <b class="num">{s.value}</b>
              {s.sub ? <small class="ff-tip__sub">{s.sub}</small> : null}
            </div>
          ))}
        </div>
      ) : null}
      {props.body ? <div class="ff-tip__body">{props.body}</div> : null}
      {adjacency ? (
        <div class="ff-tip__adj" data-testid="tooltip-adjacency">
          <b>{adjacency.label}</b> {adjacency.text}
        </div>
      ) : null}
      {props.foot ? <div class="ff-tip__foot">{props.foot}</div> : null}
    </div>
  );
}
