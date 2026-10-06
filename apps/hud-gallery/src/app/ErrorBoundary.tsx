import { Component } from 'preact';
import type { ComponentChildren, JSX } from 'preact';
import { reportError } from './global.ts';

interface Props {
  readonly storyId: string;
  readonly children?: ComponentChildren;
}

interface State {
  readonly error: string | null;
}

/** Catches render errors of a story, reports them to window.__HUD_GALLERY__.errors and shows them. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  override componentDidCatch(error: unknown): void {
    const msg = error instanceof Error ? (error.stack ?? error.message) : String(error);
    reportError(`render of ${this.props.storyId} failed: ${msg}`);
    this.setState({ error: msg });
  }

  override render(): JSX.Element {
    if (this.state.error !== null) {
      return (
        <pre class="gal-error" data-story-error="">
          {`Story ${this.props.storyId} konnte nicht gerendert werden:\n${this.state.error}`}
        </pre>
      );
    }
    return <>{this.props.children}</>;
  }
}
