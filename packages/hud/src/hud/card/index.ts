// Barrel of the HUD group "card" (hud-p4-card): command card, tech tabs, cells, order bar/buttons/tooltip,
// grid key layers (demo data: src/demo/card.ts, exported via src/demo/index.ts).
import './card.css';

export { CardCell, cellAriaLabel } from './CardCell.tsx';
export type { CardCellProps } from './CardCell.tsx';
export { NO_CELL_INPUTS, ORDER_IDS_IN_GRID, cellActionable, cellViews, tierStripes } from './cells.ts';
export type { CellDisabledReason, CellInputs, CellKind, CellView, TierStripe } from './cells.ts';
export { CommandCard, gridNavIndex } from './CommandCard.tsx';
export type { CommandCardProps } from './CommandCard.tsx';
export {
  isSelfDestructKey,
  isTextTarget,
  keyInputFromEvent,
  resolveGridKey,
  shouldPreventDefault,
} from './gridKeys.ts';
export type { CameraDirection, GridKeyAction, GridKeyContext, InputMode, KeyInput, KeyScheme, PassReason } from './gridKeys.ts';
export {
  builderForTier,
  cardHeadText,
  boundedText,
  cellText,
  gridLabel,
  isMacPlatform,
  lockText,
  orderKeyCap,
  orderKeysText,
  orderName,
  orderShort,
  selfDestructKeys,
} from './labels.ts';
export { OrderBar } from './OrderBar.tsx';
export type { OrderBarProps } from './OrderBar.tsx';
export { OrderButton, orderAriaLabel } from './OrderButton.tsx';
export type { OrderButtonProps } from './OrderButton.tsx';
export { OrderTooltip, orderStateText } from './OrderTooltip.tsx';
export type { OrderTooltipProps } from './OrderTooltip.tsx';
export { cardSpec, isTabLocked, orderBarVisible, resolveCardSpec } from './spec.ts';
export { TechTabs, tabLockReason } from './TechTabs.tsx';
export type { TechTabsProps } from './TechTabs.tsx';
export { cellTooltipTarget, headBuildPower, sameTooltipTarget, useTooltipOwner } from './tooltipTarget.ts';
export type { TooltipOwner } from './tooltipTarget.ts';
export { dispatchGridAction, dispatchStripAction, gridKeyContext, handleHotkey, useCardHotkeys } from './useCardHotkeys.ts';
export type { CardHotkeysOptions } from './useCardHotkeys.ts';
