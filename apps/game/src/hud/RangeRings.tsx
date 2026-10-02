import type { RangeKind, RangeRing, RangeState } from './range-rings.ts';
import './range-rings.css';

const LABELS: Record<RangeKind, readonly [string, string]> = {
  vision: ['Sicht', 'Vision'], radar: ['Radar', 'Radar'], weapon: ['Waffe', 'Weapon'],
  'weapon-min': ['Mindestabstand', 'Minimum range'], build: ['Bau/Reparatur', 'Build/repair'],
};
const STATES: Record<RangeState, readonly [string, string]> = {
  active: ['', ''], planned: ['geplant', 'planned'], incomplete: ['im Bau', 'under construction'],
  paused: ['pausiert', 'paused'], unpowered: ['ohne Energie', 'unpowered'], stalled: ['Versorgung begrenzt', 'supply limited'],
};
function text(ring: RangeRing, english: boolean): string {
  const lang = english ? 1 : 0, status = STATES[ring.state][lang];
  const radius = Math.round(ring.radiusRaw / 4096 * 10) / 10;
  return `${LABELS[ring.kind][lang]} ${radius}${status ? ` (${status})` : ''}`;
}

/** Pass the controller's projected signal value; the SVG is in physical viewport pixels. */
export function RangeRings({ rings, locale = 'de' }: { readonly rings: readonly RangeRing[]; readonly locale?: string }) {
  if (rings.length === 0) return null;
  const english = locale === 'en', legends = new Map<string, RangeRing>();
  for (const ring of rings) legends.set(`${ring.kind}:${ring.state}`, ring);
  const showLabels = rings.every(ring => ring.source === 'placement') || new Set(rings.map(ring => ring.key.split(':')[1])).size === 1;
  return <div class="live-range-overlay" data-testid="range-overlay" data-source={rings[0]!.source}>
    <svg class="live-range-rings" data-testid="range-rings" aria-hidden="true" focusable="false">
      {rings.map(ring => <g key={ring.key} class={`live-range-ring range-${ring.kind} state-${ring.state}`} data-testid="range-ring" data-kind={ring.kind} data-state={ring.state} data-status={ring.state} data-source={ring.source} data-x={ring.x} data-z={ring.z} data-radius={ring.radiusRaw / 4096} data-radius-raw={ring.radiusRaw}>
        {ring.segments.map((points, i) => <polyline key={i} points={points}/>)}
        {showLabels && ring.label && <text x={ring.label[0]} y={ring.label[1] - 7} text-anchor="middle">{text(ring, english)}</text>}
      </g>)}
    </svg>
    <div class="live-range-legend" aria-label={english ? 'Displayed ranges' : 'Angezeigte Reichweiten'} data-testid="range-legend">
      {Array.from(legends.values()).map(ring => <span key={`${ring.kind}:${ring.state}`} class={`range-${ring.kind} state-${ring.state}`}><i/>{LABELS[ring.kind][english ? 1 : 0]}{ring.state !== 'active' && <small>{STATES[ring.state][english ? 1 : 0]}</small>}</span>)}
    </div>
  </div>;
}
