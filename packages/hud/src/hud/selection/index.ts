// Barrel of the HUD group "selection" (hud-p3): selection panel, unit detail, order chain, multi
// selection, factory detail and queue (demo data: src/demo/selection.ts via src/demo/index.ts).
// Only selection-specific names are exported (src/index.ts re-exports every group barrel with export *).
import './selection.css';

export { SelectionPanel, selectionHeadEnd, selectionHeadTitle } from './SelectionPanel.tsx';
export type { SelectionPanelProps } from './SelectionPanel.tsx';
export { SelectionEmpty } from './SelectionEmpty.tsx';
export { UnitDetail } from './UnitDetail.tsx';
export { OrderQueue, orderRows } from './OrderQueue.tsx';
export { SelectionGroups, SelectionMulti, SelectionSummary, SelectionUnits } from './SelectionMulti.tsx';
export { FactoryDetail } from './FactoryDetail.tsx';
export { FactoryQueue, factoryQueueState } from './FactoryQueue.tsx';
export { ORDER_ICONS as ORDER_CHAIN_ICONS, orderLabel as orderChainLabel, orderValue as orderChainValue } from './labels.ts';
