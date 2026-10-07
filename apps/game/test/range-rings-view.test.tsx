// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { RangeRings } from '../src/hud/RangeRings.tsx';
import type { RangeRing } from '../src/hud/range-rings.ts';

const containers: HTMLDivElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) { act(() => render(null, container)); container.remove(); }
});
function fixture(rings: readonly RangeRing[], locale = 'de') {
  const container = document.createElement('div'); document.body.append(container); containers.push(container);
  act(() => render(<RangeRings rings={rings} locale={locale}/>, container));
  return container;
}
const radar: RangeRing = {
  key: 'placement:-1:radar:475136', kind: 'radar', radiusRaw: 116 * 4096, x: 20 * 4096, z: 30 * 4096,
  source: 'placement', state: 'planned', segments: ['40,50 42,52 46,52', '80,52 82,50'], label: [200, 180],
};

describe('noninteractive range overlay', () => {
  it('exposes actual radii, source, status and separate projected polylines and uses localized labels', () => {
    const container = fixture([radar]), root = container.querySelector('[data-testid="range-rings"]')!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    const ring = root.querySelector('[data-testid="range-ring"]')!;
    expect(ring.getAttribute('data-kind')).toBe('radar');
    expect(ring.getAttribute('data-radius')).toBe('116');
    expect(ring.getAttribute('data-radius-raw')).toBe('475136');
    expect(ring.getAttribute('data-x')).toBe(String(20 * 4096));
    expect(ring.getAttribute('data-z')).toBe(String(30 * 4096));
    expect(ring.getAttribute('data-status')).toBe('planned');
    expect(ring.getAttribute('data-source')).toBe('placement');
    expect([...ring.querySelectorAll('polyline')].map(line => line.getAttribute('points'))).toEqual(radar.segments);
    expect(ring.querySelector('text')!.textContent).toBe('Radar 116 (geplant)');
    expect(container.querySelector('[data-testid="range-legend"]')!.textContent).toContain('geplant');
    expect(fixture([radar], 'en').textContent).toContain('Radar 116 (planned)');
    expect(container.querySelector('button,input,a')).toBeNull();
  });

  it('deduplicates legend categories and suppresses repeated world labels on multi-unit selections', () => {
    const one: RangeRing = { ...radar, key: 'selection:0:radar:475136', source: 'selection', state: 'active' };
    const two: RangeRing = { ...one, key: 'selection:1:radar:475136', x: one.x + 4096 };
    const container = fixture([one, two]);
    expect(container.querySelectorAll('[data-testid="range-ring"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="range-legend"] span')).toHaveLength(1);
    expect(container.querySelector('text')).toBeNull();
    expect(fixture([]).innerHTML).toBe('');
  });
});
