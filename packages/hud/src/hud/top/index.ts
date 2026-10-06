// Barrel of the HUD group "top" (hud-p2-top): resource bar + flow details, match status, pause banner,
// alert feed, unit/resource tooltip contents, their text builders (demo data: src/demo/top.ts via src/demo/index.ts).
import './top.css';

export { ResourceBar, ResourceMeter, FlowDetails, FLOW_DETAILS_ID, meterStateText } from './ResourceBar.tsx';
export type { FlowDetailsProps, ResourceMeterProps } from './ResourceBar.tsx';
export { MatchStatus, speedText } from './MatchStatus.tsx';
export { PauseBanner, PAUSE_KEY_CODE } from './PauseBanner.tsx';
export { Alert, AlertFeed, SHIFT_SPACE_GLYPH, SPACE_GLYPH } from './AlertFeed.tsx';
export type { AlertProps } from './AlertFeed.tsx';
export { UnitTooltip } from './UnitTooltip.tsx';
export type { UnitTooltipProps } from './UnitTooltip.tsx';
export { ResourceTooltip, resourceViewKey } from './ResourceTooltip.tsx';
export type { ResourceTooltipProps, ResourceTooltipView } from './ResourceTooltip.tsx';
export { unitTooltipStats } from './tooltipStats.ts';
export { TOOLTIP_SAMPLE_MS, useSampled } from './sample.ts';
export {
  META_SEPARATOR,
  PRIORITY_SEPARATOR,
  ageLabel,
  alertMeta,
  alertTitle,
  consumerKindLabel,
  consumerLabel,
  incomeSourceLabel,
  layersLabel,
  priorityLabel,
  regionLabel,
  resourceLabel,
  upgradeTargetLabel,
} from './labels.ts';
