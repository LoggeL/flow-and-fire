/**
 * Panel layout over the map canvas: top bar, left column (tools, symmetry), right column
 * (properties, validation), status bar and the help overlay. The root ignores the pointer (the
 * map in the middle stays usable); every panel takes it back.
 */
import type { Signal } from '@preact/signals';
import type { JSX } from 'preact';
import type { EditorStore } from '../../app/store.ts';
import type { PanelIo } from '../types.ts';
import { HelpOverlay } from './HelpOverlay.tsx';
import { PropertiesPanel } from './PropertiesPanel.tsx';
import { StatusBar } from './StatusBar.tsx';
import { SymmetryPanel } from './SymmetryPanel.tsx';
import { ToolPalette } from './ToolPalette.tsx';
import { TopBar } from './TopBar.tsx';
import { ValidationPanel } from './ValidationPanel.tsx';

export interface AppProps {
  readonly store: EditorStore;
  readonly io: PanelIo;
  readonly helpOpen: Signal<boolean>;
}

export function PanelsApp(props: AppProps): JSX.Element {
  const { store, io, helpOpen } = props;
  return (
    <div class="me-ui" data-testid="panels">
      <TopBar store={store} io={io} helpOpen={helpOpen} />
      <aside class="me-col me-col-left">
        <ToolPalette store={store} />
        <SymmetryPanel store={store} io={io} />
      </aside>
      <aside class="me-col me-col-right">
        <PropertiesPanel store={store} />
        <ValidationPanel store={store} io={io} />
      </aside>
      <StatusBar store={store} io={io} />
      <HelpOverlay open={helpOpen} />
    </div>
  );
}
