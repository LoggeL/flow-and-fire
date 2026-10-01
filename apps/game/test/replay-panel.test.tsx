// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { ReplayPanel } from '../src/replay/ReplayPanel.tsx';
import { ReplayController } from '../src/replay/controller.ts';
import { ReplayLibrary, loadReplayLabels, recordingDate, saveReplayLabel, REPLAY_LABELS_KEY, type RecordedGame } from '../src/replay/library.ts';
import type { WorkerLike } from '../src/worker-link.ts';

class WorkerStub implements WorkerLike {
  readonly messages: { kind?: string; id?: number; name?: string }[] = [];
  readonly events = new Map<string, Set<(event: object) => void>>();
  postMessage(message: unknown): void { this.messages.push(message as never); }
  addEventListener(type: string, listener: (event: object) => void): void { const group = this.events.get(type) ?? new Set(); group.add(listener); this.events.set(type, group); }
  removeEventListener(type: string, listener: (event: object) => void): void { this.events.get(type)?.delete(listener); }
  terminate(): void {}
  emit(data: unknown): void { for (const listener of this.events.get('message') ?? []) listener({ data }); }
}
const containers: HTMLElement[] = [];
afterEach(() => { for (const c of containers.splice(0)) { act(() => render(null, c)); c.remove(); } localStorage.clear(); });
const state = (compared: number, tick: number) => ({ tick, endTick: 2553, paused: true, speed: 1, viewer: -1, armies: [{ index: 0, name: 'Spieler' }],
  result: { compared, subCompared: compared ? 1 : 0, divergences: [], tainted: false, truncated: false } });
function mount(locale: 'de' | 'en', controller: ReplayController | null, open = false) {
  const library = new ReplayLibrary(new WorkerStub()), container = document.createElement('div');
  document.body.append(container); containers.push(container);
  act(() => render(<ReplayPanel library={library} controller={controller} open={open} assets={{ simBin: new ArrayBuffer(0), map: new Uint8Array(0) }} exportCurrentLog={null}
    onOpen={() => {}} onExit={null} beforeHistoricalNavigate={async () => {}} locale={locale}/>, container));
  return { container, library };
}

describe('replay panel', () => {
  it('says a check is pending until hashes were actually compared, then reports the result', () => {
    const controller = new ReplayController(new WorkerStub(), Uint8Array.of(1));
    act(() => { controller.state.value = state(0, 0) as never; });
    const { container } = mount('de', controller);
    const output = container.querySelector('[data-testid=replay-verification]')!;
    expect(output.getAttribute('data-state')).toBe('pending');
    expect(output.textContent).toContain('Prüfung ausstehend'); expect(output.textContent).not.toContain('Keine Abweichung');
    act(() => { controller.state.value = state(255, 2553) as never; });
    expect(output.getAttribute('data-state')).toBe('clean');
    expect(output.textContent).toContain('255 Regel-Hashes, 1 Tabellen geprüft. Keine Abweichung.');
  });
  it('is localized', () => {
    const controller = new ReplayController(new WorkerStub(), Uint8Array.of(1));
    act(() => { controller.state.value = state(0, 0) as never; });
    const { container } = mount('en', controller);
    expect(container.querySelector('[data-testid=replay-play]')!.textContent).toBe('Play');
    expect(container.querySelector('[data-testid=replay-verification]')!.textContent).toContain('Check pending');
    expect(container.textContent).toContain('All armies');
  });
});

describe('replay library helpers', () => {
  it('keeps file names and stores player labels separately', () => {
    expect(loadReplayLabels()).toEqual({});
    saveReplayLabel('log-20261001T120000000-fd0bd57c-1.faflog', '  Erste Partie  ');
    expect(loadReplayLabels()).toEqual({ 'log-20261001T120000000-fd0bd57c-1.faflog': 'Erste Partie' });
    saveReplayLabel('log-20261001T120000000-fd0bd57c-1.faflog', ''); expect(loadReplayLabels()).toEqual({});
    localStorage.setItem(REPLAY_LABELS_KEY, '{"a":1,"b":"ok"}'); expect(loadReplayLabels()).toEqual({ b: 'ok' });
    localStorage.setItem(REPLAY_LABELS_KEY, 'broken'); expect(loadReplayLabels()).toEqual({});
  });
  it('derives the start time from existing recording names and sends deletes to the worker', () => {
    expect(recordingDate('log-20261001T123456789-fd0bd57c-k1.faflog')?.toISOString()).toBe('2026-10-01T12:34:56.789Z');
    expect(recordingDate('other.faflog')).toBeNull();
    const worker = new WorkerStub(), library = new ReplayLibrary(worker);
    void library.delete('log-20261001T123456789-fd0bd57c-k1.faflog').catch(() => {});
    expect(worker.messages.at(-1)).toMatchObject({ kind: 'delete', name: 'log-20261001T123456789-fd0bd57c-k1.faflog' });
    library.dispose();
  });
  it('lists, searches and renames stored recordings in the library view', async () => {
    const files: RecordedGame[] = [
      { name: 'log-20261001T120000000-fd0bd57c-1.faflog', bytes: 10, endTick: 600, complete: true, tainted: false, buildHash: 'x', mapSimHash: 1, mapSizeWu: 512, error: null },
      { name: 'log-20260930T080000000-fd0bd57c-2.faflog', bytes: 10, endTick: 300, complete: false, tainted: false, buildHash: 'x', mapSimHash: 2, mapSizeWu: 512, error: null },
    ];
    const { container, library } = mount('de', null, true);
    const worker = (library as unknown as { worker: WorkerStub }).worker;
    const list = worker.messages.find(m => m.kind === 'list')!;
    await act(async () => { worker.emit({ t: 'replay-task-result', id: list.id, value: files }); await Promise.resolve(); });
    expect(container.querySelectorAll('[data-testid=replay-library] li')).toHaveLength(2);
    const search = container.querySelector<HTMLInputElement>('[data-testid=replay-search]')!;
    act(() => { search.value = 'Teilaufnahme'; search.dispatchEvent(new Event('input', { bubbles: true })); });
    expect([...container.querySelectorAll('[data-testid=replay-library] li')].map(li => li.getAttribute('data-name'))).toEqual([files[1]!.name]);
    const rename = [...container.querySelectorAll('button')].find(b => b.textContent === 'Umbenennen')!;
    act(() => rename.click());
    const input = container.querySelector<HTMLInputElement>('[data-testid=replay-rename-input]')!;
    act(() => { input.value = 'Probelauf'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(loadReplayLabels()[files[1]!.name]).toBe('Probelauf');
    expect(container.querySelector('[data-testid=replay-library] li .replay-entry b')!.textContent).toBe('Probelauf');
    library.dispose();
  });
});
