import { Component } from 'preact';
import type { ComponentChildren } from 'preact';

export interface PanelBoundaryProps {
  /** Name for the error report (`ResourceBar`, `Tooltip` …). */
  readonly name: string;
  /** A change of this value clears a caught error and renders the children again (e.g. the next tooltip target). */
  readonly resetKey?: unknown;
  readonly children?: ComponentChildren;
}

interface PanelBoundaryState {
  readonly failed: boolean;
  readonly key: unknown;
}

/**
 * Error boundary around one HUD panel or the tooltip content: a data error inside one panel (e.g. game data
 * the HUD does not know) removes only that panel and is reported through console.error, instead of tearing
 * down the whole HUD tree. Renders no DOM of its own.
 */
export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  override state: PanelBoundaryState = { failed: false, key: undefined };

  static override getDerivedStateFromProps(props: PanelBoundaryProps, state: PanelBoundaryState): Partial<PanelBoundaryState> | null {
    if (state.failed && !Object.is(props.resetKey, state.key)) return { failed: false, key: props.resetKey };
    return Object.is(props.resetKey, state.key) ? null : { key: props.resetKey };
  }

  override componentDidCatch(error: unknown): void {
    console.error(`@faf/hud: panel '${this.props.name}' failed to render`, error);
    this.setState({ failed: true, key: this.props.resetKey });
  }

  override render(): ComponentChildren {
    return this.state.failed ? null : this.props.children;
  }
}
