/**
 * Line chart of the score screen (ui.md §5.15): two series on ONE y axis in team colours, the second
 * (enemy) dashed, direct labels at the line ends, legend, crosshair tooltip on pointer move (and with ←/→
 * when the plot has keyboard focus). Size is measured by a ResizeObserver, never in an update path.
 */
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { fmtInt, fmtTime } from '../../format/index.ts';
import { t } from '../../i18n/t.ts';
import { useHud } from '../../model/index.ts';
import { sampleTime } from '../../model/menus/score.ts';
import type { ScoreSeries } from '../../model/menus/score.ts';
import { chartGeometry, indexAtX, linePath, minuteLabel, separateLabels, timeTicks } from './chart.ts';
import type { ChartBox } from './chart.ts';

export interface ChartSide {
  /** House label ("Ambrecht"). */
  readonly name: string;
  /** CSS colour (team colour in the active mode). */
  readonly color: string;
}

export interface ScoreChartProps {
  readonly series: ScoreSeries;
  readonly title: string;
  readonly sub: string;
  /** Unit behind values in the tooltip ("M/s"). */
  readonly unit: string;
  readonly durationS: number;
  readonly self: ChartSide;
  readonly enemy: ChartSide;
  /** Fallback size before the first measurement (and in DOM tests without layout). */
  readonly fallback?: { readonly width: number; readonly height: number };
}

/** Plot margins in CSS px at scale 1 (y labels left, direct labels right). */
export const CHART_MARGINS = { left: 44, right: 70, top: 12, bottom: 22 } as const;

function useSize(fallback: { readonly width: number; readonly height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

export function ScoreChart(props: ScoreChartProps): JSX.Element {
  const { series, durationS, self, enemy } = props;
  const { ref, size } = useSize(props.fallback ?? { width: 640, height: 200 });
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Margins follow the UI scale (1rem = 16 px × scale) from the model, no layout read.
  const rem = useHud().scale.value || 1;
  const box: ChartBox = {
    width: size.width,
    height: size.height,
    left: CHART_MARGINS.left * rem,
    right: CHART_MARGINS.right * rem,
    top: CHART_MARGINS.top * rem,
    bottom: CHART_MARGINS.bottom * rem,
  };
  const g = chartGeometry(box, durationS, [series.self, series.enemy]);
  const count = Math.min(series.self.length, series.enemy.length);
  const last = count - 1;
  const endT = sampleTime(Math.max(0, last), series.stepS, durationS);
  const endSelf = series.self[last] ?? 0;
  const endEnemy = series.enemy[last] ?? 0;
  const labelGap = 14 * rem;
  const [labSelf, labEnemy] = separateLabels([g.y(endSelf), g.y(endEnemy)], labelGap, g.y0 + 4 * rem, g.y1);
  const pick = (clientX: number): void => {
    const r = svgRef.current?.getBoundingClientRect();
    const px = clientX - (r?.left ?? 0);
    setHover(indexAtX(g, px, count, series.stepS, durationS));
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const cur = hover ?? last;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? last : Math.min(last, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)));
    setHover(next);
  };
  const hx = hover !== null ? g.x(sampleTime(hover, series.stepS, durationS)) : 0;
  const label = t('ui.score.chart.label', { title: props.title, self: self.name, selfValue: fmtInt(endSelf), enemy: enemy.name, enemyValue: fmtInt(endEnemy) });

  return (
    <div class="chart ff-panel" data-component="ScoreChart" data-testid={`chart-${series.id}`}>
      <div class="chart__h">
        <b>{props.title}</b>
        <small>{props.sub}</small>
        <span class="lg" aria-hidden="true">
          <span style={{ '--team': self.color }}>
            <i />
            {self.name}
          </span>
          <span style={{ '--team': enemy.color }}>
            <i class="dash" />
            {enemy.name}
          </span>
        </span>
      </div>
      <div
        ref={ref}
        class="chart__plot"
        tabIndex={0}
        role="group"
        aria-label={label}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        data-testid={`chart-${series.id}-plot`}
      >
        <svg ref={svgRef} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true" data-testid={`chart-${series.id}-svg`}>
          {g.scale.ticks.map((v) => (
            <g key={`y${v}`}>
              <line class="gl" x1={g.x0} x2={g.x1} y1={g.y(v)} y2={g.y(v)} />
              <text class="tk" x={g.x0 - 6 * rem} y={g.y(v) + 4 * rem} text-anchor="end">
                {fmtInt(v)}
              </text>
            </g>
          ))}
          {timeTicks(durationS).map((s) => (
            <text key={`x${s}`} class="tk" x={g.x(s)} y={size.height - 5 * rem} text-anchor="middle">
              {minuteLabel(s)}
            </text>
          ))}
          <line class="ax" x1={g.x0} x2={g.x1} y1={g.y(0)} y2={g.y(0)} />
          <path d={linePath(g, series.enemy, series.stepS, durationS)} fill="none" stroke={enemy.color} stroke-width="2" stroke-dasharray="6 4" data-series="enemy" />
          <path d={linePath(g, series.self, series.stepS, durationS)} fill="none" stroke={self.color} stroke-width="2" data-series="self" />
          <circle cx={g.x(endT)} cy={g.y(endSelf)} r="4" fill={self.color} stroke="#171412" stroke-width="2" />
          <circle cx={g.x(endT)} cy={g.y(endEnemy)} r="4" fill={enemy.color} stroke="#171412" stroke-width="2" />
          <text class="lab" x={g.x(endT) + 8 * rem} y={(labSelf ?? 0) + 4 * rem} data-end="self">
            {fmtInt(endSelf)}
          </text>
          <text class="lab" x={g.x(endT) + 8 * rem} y={(labEnemy ?? 0) + 4 * rem} data-end="enemy">
            {fmtInt(endEnemy)}
          </text>
          {hover !== null ? (
            <line class="xh" x1={hx} x2={hx} y1={g.y0} y2={g.y(0)} data-testid={`chart-${series.id}-crosshair`} />
          ) : null}
          <rect
            x={g.x0}
            y={g.y0}
            width={g.x1 - g.x0}
            height={g.y1 - g.y0}
            fill="transparent"
            onPointerMove={(e) => pick(e.clientX)}
            onPointerLeave={() => setHover(null)}
            data-testid={`chart-${series.id}-hit`}
          />
        </svg>
        {hover !== null ? (
          <div class="charttip" style={{ left: `${Math.min(hx + 10 * rem, size.width - 170 * rem)}px` }} data-testid={`chart-${series.id}-tip`}>
            <b>{fmtTime(sampleTime(hover, series.stepS, durationS))}</b>
            <span style={{ '--team': self.color }}>
              <i />
              {t('ui.score.tip.value', { house: self.name, value: fmtInt(series.self[hover] ?? 0), unit: props.unit })}
            </span>
            <span style={{ '--team': enemy.color }}>
              <i />
              {t('ui.score.tip.value', { house: enemy.name, value: fmtInt(series.enemy[hover] ?? 0), unit: props.unit })}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
