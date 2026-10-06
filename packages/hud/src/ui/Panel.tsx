import type { ComponentChildren, JSX } from 'preact';
import { cx } from './cx.ts';

export type PanelTone = 'default' | 'copper' | 'ember' | 'crit';

export interface PanelProps {
  readonly tone?: PanelTone | undefined;
  /** Opaque surface (--surface-1) instead of the 0.92 HUD surface. */
  readonly solid?: boolean | undefined;
  readonly chamfer?: 's' | 'm' | 'l' | undefined;
  /** data-component name of the HUD component this panel is (default "Panel"). */
  readonly component?: string | undefined;
  /** data-panel id for the layout check (non-overlap, inside viewport). */
  readonly panelId?: string | undefined;
  /** Accessible region name (translated). */
  readonly label?: string | undefined;
  readonly as?: 'section' | 'div' | 'aside' | undefined;
  readonly class?: string | undefined;
  readonly style?: JSX.CSSProperties | undefined;
  readonly testId?: string | undefined;
  readonly children?: ComponentChildren | undefined;
}

/** Chamfered panel (ui.md §3.4): border = outer clip, surface = inner pseudo element; contain: layout paint style. */
export function Panel(props: PanelProps): JSX.Element {
  const { tone = 'default', chamfer = 'm', as: Tag = 'section' } = props;
  return (
    <Tag
      class={cx(
        'ff-panel',
        tone !== 'default' && `ff-panel--${tone}`,
        props.solid && 'ff-panel--solid',
        chamfer !== 'm' && `ff-panel--chamfer-${chamfer}`,
        props.class,
      )}
      style={props.style}
      aria-label={props.label}
      data-component={props.component ?? 'Panel'}
      data-testid={props.testId ?? 'panel'}
      data-panel={props.panelId}
    >
      {props.children}
    </Tag>
  );
}

export interface PanelHeadProps {
  /** Translated title (rendered in caps by CSS). */
  readonly title: ComponentChildren;
  /** Right-aligned meta content. */
  readonly end?: ComponentChildren | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Panel head (.ff-ph): 24 px, caps, copper diamond marker, meta text on the right. */
export function PanelHead({ title, end, class: cls, testId }: PanelHeadProps): JSX.Element {
  return (
    <div class={cx('ff-ph', cls)} data-component="PanelHead" data-testid={testId ?? 'panel-head'}>
      <span data-fit="">{title}</span>
      {end !== undefined && end !== null ? <span class="ff-ph__end">{end}</span> : null}
    </div>
  );
}
