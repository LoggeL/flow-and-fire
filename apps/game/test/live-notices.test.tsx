// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { HudProvider, createHudModel, createRecordingCommands, locale, type AlertItem } from '@faf/hud';
import { LiveNotices } from '../src/hud/LiveNotices.tsx';

// Presentation model only. Native event/producer qualification remains a separate gate.
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) { act(() => render(null, container)); container.remove(); }
  locale.value = 'de';
});

function fixture(items: readonly AlertItem[]) {
  const model = createHudModel();
  model.locale.value = 'en';
  model.match.timeS.value = 10;
  model.alerts.items.value = items;
  const recording = createRecordingCommands({ toggleFlowDetails: () => { model.eco.detailsOpen.value = !model.eco.detailsOpen.peek(); } });
  const container = document.createElement('div');
  document.body.append(container); containers.push(container);
  act(() => render(<HudProvider model={model} commands={recording.commands}><LiveNotices/></HudProvider>, container));
  const getByTestId = (id: string): HTMLElement => {
    const element = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!element) throw new Error(`Missing notice element ${id}`);
    return element;
  };
  return { model, recording, container, getByTestId };
}
const common = { count: 1, createdAtS: 5, lastAtS: 5, location: null } as const;

describe('compact Game notices, modeled presentation only', () => {
  it('preserves own flow alert actions and shows even an authoritative zero flow value', () => {
    const source: AlertItem = { ...common, id: 1, type: 'massStall', flow: 0, count: 3 };
    const { getByTestId, recording } = fixture([source]);
    const row = getByTestId('alert-1');
    expect(row.textContent).toContain('Mass low ×3');
    expect(row.textContent).toContain('0%');
    expect(row.textContent).not.toContain('ago');
    act(() => row.click());
    act(() => row.click());
    expect(recording.log).toEqual([
      { name: 'toggleFlowDetails', args: [] },
      { name: 'jumpToAlert', args: [1] },
      { name: 'jumpToAlert', args: [1] },
    ]);
    expect(source).toEqual({ ...common, id: 1, type: 'massStall', flow: 0, count: 3 });
  });

  it('retains real subject names and location jumps, but gives storage notices no empty jump action', () => {
    const { getByTestId, container, recording } = fixture([
      { ...common, id: 2, type: 'buildComplete', subjectTypeId: 'core:lnd_t3_heavy', location: { x: 12, z: 18 } },
      { ...common, id: 3, type: 'storageFull' },
    ]);
    const completed = getByTestId('alert-2'), storage = getByTestId('alert-3');
    expect(completed.textContent).toContain('Construction complete: Bulwark');
    expect(completed.tagName).toBe('BUTTON');
    act(() => completed.click());
    expect(recording.log).toEqual([{ name: 'jumpToAlert', args: [2] }]);
    expect(storage.textContent).toBe('Storage full');
    expect(storage.tagName).toBe('DIV');
    expect(storage.querySelector('button')).toBeNull();
    expect(container.querySelector('.live-notice-flow')).toBeNull();
  });
});
