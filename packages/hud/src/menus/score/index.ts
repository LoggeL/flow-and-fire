// Barrel of the menu "score" (hud-p6-menus): score screen, history chart and its pure chart maths.
import '../../styles/menus.css';
import './score.css';

export { ScoreScreen, eventText, shortTime } from './ScoreScreen.tsx';
export { CHART_MARGINS, ScoreChart } from './ScoreChart.tsx';
export type { ChartSide, ScoreChartProps } from './ScoreChart.tsx';
export { chartGeometry, indexAtX, linePath, minuteLabel, niceScale, separateLabels, timeTicks } from './chart.ts';
export type { ChartBox, ChartGeometry, NiceScale } from './chart.ts';
