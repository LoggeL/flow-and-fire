/**
 * DOM HUD of the demo (refreshed a few times per second, never per event): engine state and load
 * progress, voices against the limits, played/stolen/dropped per second and in total, main-thread
 * timings, mixer sliders (persisted by the engine's settings controller) and the alert history with
 * jump buttons.
 */

import { DECODE_PATHS, DROP_REASONS, SOUND_CATEGORIES, type AlertRecord, type AudioSettings, type SoundCategory } from '@faf/audio';
import type { FafAudioEngine } from '@faf/audio/engine';
import type { DemoStats } from './hook.ts';

/** What the HUD needs from the demo controller. */
export interface HudActions {
  toggleRun(): void;
  restart(opts: { shots: number; speed: number; seed: number }): void;
  setSpeed(speed: number): void;
  ack(): void;
  jumpTo(x: number, z: number): void;
}

const VOLUME_KEYS = ['master', 'sfx', 'ui', 'alerts', 'music', 'ambience'] as const;
const VOLUME_LABELS: Record<(typeof VOLUME_KEYS)[number], string> = {
  master: 'Master',
  sfx: 'Effekte',
  ui: 'UI',
  alerts: 'Alerts',
  music: 'Musik',
  ambience: 'Ambience',
};
const DROP_LABELS: Record<string, string> = {
  cooldown: 'Cooldown',
  categoryLimit: 'Kategorie-Limit',
  soundLimit: 'Sound-Limit',
  globalLimit: 'Global-Limit',
  culled: 'unhörbar (culled)',
  notLoaded: 'nicht geladen',
  unknownSound: 'unbekannt',
  locked: 'gesperrt',
  muted: 'stumm',
};

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (e === null) throw new Error(`#${id} missing`);
  return e as T;
}

function fmt(v: number, digits = 3): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '–';
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

interface CounterRow {
  key: string;
  label: string;
  perSec: HTMLTableCellElement;
  total: HTMLTableCellElement;
}

export class Hud {
  private readonly catRows = new Map<SoundCategory, { bar: HTMLElement; fill: HTMLElement; peak: HTMLElement; text: HTMLElement }>();
  private readonly counters: CounterRow[] = [];
  private readonly timingRows = new Map<string, HTMLTableCellElement[]>();
  private readonly sliders = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement }>();
  private prevTotals: Record<string, number> | null = null;
  private prevAt = 0;
  private alertsDirty = true;
  private lastAlertRender = 0;

  constructor(
    private readonly engine: FafAudioEngine,
    private readonly actions: HudActions,
    initial: { shots: number; speed: number; seed: number },
  ) {
    el<HTMLInputElement>('in-shots').value = String(initial.shots);
    el<HTMLSelectElement>('in-speed').value = String(initial.speed);
    el<HTMLInputElement>('in-seed').value = String(initial.seed);
    el('btn-start').addEventListener('click', () => this.actions.toggleRun());
    const restart = (): void => this.actions.restart(this.formValues());
    el('in-shots').addEventListener('change', restart);
    el('in-seed').addEventListener('change', restart);
    el('in-speed').addEventListener('change', () => this.actions.setSpeed(this.formValues().speed));
    el('btn-ack').addEventListener('click', () => this.actions.ack());
    this.buildCounters();
    this.buildTiming();
    this.buildSliders();
  }

  formValues(): { shots: number; speed: number; seed: number } {
    return {
      shots: Number(el<HTMLInputElement>('in-shots').value) || 0,
      speed: Number(el<HTMLSelectElement>('in-speed').value) || 1,
      seed: Math.trunc(Number(el<HTMLInputElement>('in-seed').value) || 0) >>> 0,
    };
  }

  setRunning(running: boolean): void {
    el('btn-start').textContent = running ? 'Stopp' : 'Start';
  }

  markAlertsDirty(): void {
    this.alertsDirty = true;
  }

  showAck(text: string): void {
    el('ack-info').textContent = text;
  }

  // -------------------------------------------------------------------------------------------

  private buildCounters(): void {
    const body = el('counters');
    const rows: [string, string][] = [
      ['played', 'gespielt'],
      ['stolen', 'gestohlen'],
      ['events', 'Sim-Events'],
      ...DROP_REASONS.map((d): [string, string] => [`drop:${d}`, `verworfen: ${DROP_LABELS[d] ?? d}`]),
    ];
    for (const [key, label] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('td');
      th.textContent = label;
      const perSec = document.createElement('td');
      perSec.className = 'n';
      const total = document.createElement('td');
      total.className = 'n';
      tr.append(th, perSec, total);
      body.append(tr);
      this.counters.push({ key, label, perSec, total });
    }
  }

  private buildTiming(): void {
    const body = el('timing');
    const rows: [string, string][] = [
      ['engine', 'Engine (mainJs, 1024 Frames)'],
      ['calls', 'Engine-Aufrufe (Lauf)'],
      ['generator', 'Szenario-Generator'],
    ];
    for (const [key, label] of rows) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.textContent = label;
      tr.append(td);
      const cells: HTMLTableCellElement[] = [];
      for (let i = 0; i < 4; i++) {
        const c = document.createElement('td');
        c.className = 'n';
        tr.append(c);
        cells.push(c);
      }
      body.append(tr);
      this.timingRows.set(key, cells);
    }
  }

  private buildSliders(): void {
    const host = el('sliders');
    const s = this.engine.settings.get();
    for (const key of VOLUME_KEYS) {
      const row = document.createElement('div');
      row.className = 'slider';
      const label = document.createElement('label');
      label.textContent = VOLUME_LABELS[key];
      label.htmlFor = `vol-${key}`;
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `vol-${key}`;
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.value = String(s[key]);
      const out = document.createElement('output');
      out.textContent = s[key].toFixed(2);
      input.addEventListener('input', () => {
        this.engine.settings.set({ [key]: Number(input.value) });
      });
      row.append(label, input, out);
      host.append(row);
      this.sliders.set(key, { input, out });
    }
    const muted = el<HTMLInputElement>('in-muted');
    const hidden = el<HTMLInputElement>('in-mute-hidden');
    muted.checked = s.muted;
    hidden.checked = s.muteWhenHidden;
    muted.addEventListener('change', () => this.engine.settings.set({ muted: muted.checked }));
    hidden.addEventListener('change', () => this.engine.settings.set({ muteWhenHidden: hidden.checked }));
    this.engine.settings.subscribe((v) => this.applySettings(v));
  }

  private applySettings(v: Readonly<AudioSettings>): void {
    for (const key of VOLUME_KEYS) {
      const sl = this.sliders.get(key)!;
      if (document.activeElement !== sl.input) sl.input.value = String(v[key]);
      sl.out.textContent = v[key].toFixed(2);
    }
    el<HTMLInputElement>('in-muted').checked = v.muted;
    el<HTMLInputElement>('in-mute-hidden').checked = v.muteWhenHidden;
  }

  private ensureCategoryRows(limits: Record<SoundCategory, number>): void {
    if (this.catRows.size > 0) return;
    const host = el('cat-bars');
    for (const c of SOUND_CATEGORIES) {
      const row = document.createElement('div');
      row.className = 'cat';
      const name = document.createElement('span');
      name.textContent = c;
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.id = `bar-${c}`;
      const fill = document.createElement('i');
      const peak = document.createElement('b');
      bar.append(fill, peak);
      const text = document.createElement('span');
      text.textContent = `0/${limits[c]}`;
      row.append(name, bar, text);
      host.append(row);
      this.catRows.set(c, { bar, fill, peak, text });
    }
  }

  // -------------------------------------------------------------------------------------------

  update(s: DemoStats, nowMs: number): void {
    const e = s.engine;
    const state = el('st-state');
    state.textContent = e.state;
    state.className = `state-${e.state}`;
    el('st-context').textContent = `${s.contextState}, ${s.sampleRate} Hz`;
    const l = s.load;
    el('st-load').textContent =
      l.phase === 'error'
        ? `Fehler: ${l.error ?? ''}`
        : `${l.phase === 'done' ? 'fertig' : l.phase === 'manifest' ? 'Manifest …' : 'lädt'} ${l.done}/${l.total} Varianten${l.failed > 0 ? `, ${l.failed} fehlgeschlagen` : ''}${l.phase === 'done' ? ` in ${Math.round(l.ms)} ms` : ''}`;
    el('st-load').className = l.phase === 'error' || l.failed > 0 ? 'err' : '';
    el('st-decoded').textContent = `${e.loadedSounds} Sounds, ${mib(e.decodedBytes)}`;
    el('st-paths').textContent = DECODE_PATHS.map((p) => `${p} ${e.decodePaths[p]}`).join(' · ');
    el('st-latency').textContent = `base ${e.baseLatencyMs === null ? '–' : `${e.baseLatencyMs.toFixed(1)} ms`} · output ${
      e.outputLatencyMs === null ? '–' : `${e.outputLatencyMs.toFixed(1)} ms`
    }`;
    el('st-timer').textContent = `Auflösung ${s.timerResolutionMs.toFixed(3)} ms${s.crossOriginIsolated ? ' (crossOriginIsolated)' : ''}`;

    const sc = s.scenario;
    el('sc-time').textContent = `${sc.simTimeS.toFixed(1)} s · ${sc.running ? 'läuft' : 'angehalten'} · ${sc.shotsPerSecond} Schüsse/s · ${sc.speed}×`;
    el('sc-events').textContent = `${sc.shots} Schüsse, ${sc.impacts} Einschläge, ${sc.deaths} Tode (${sc.commanderDeaths} Vögte), ${sc.alerts} Alerts, ${sc.inFlight} im Flug`;
    el('sc-units').textContent = `blau ${sc.alive[0]} · rot ${sc.alive[1]}`;

    // Voices.
    this.ensureCategoryRows(s.categoryLimits);
    const total = el('bar-total');
    (total.firstElementChild as HTMLElement).style.width = `${(100 * e.voices) / s.voiceLimit}%`;
    (total.lastElementChild as HTMLElement).style.left = `${(100 * s.maxVoicesSeen) / s.voiceLimit}%`;
    total.classList.toggle('full', e.voices >= s.voiceLimit);
    el('voices-total').textContent = `${e.voices}/${s.voiceLimit}`;
    el('voices-tails').textContent = `${e.tails} (max. ${s.maxTailsSeen})`;
    el('voices-peak').textContent = `${s.maxVoicesSeen} seit Start (Engine: ${e.peakVoices})`;
    for (const c of SOUND_CATEGORIES) {
      const row = this.catRows.get(c)!;
      const lim = s.categoryLimits[c];
      const n = e.voicesByCategory[c];
      row.fill.style.width = `${Math.min(100, (100 * n) / lim)}%`;
      row.peak.style.left = `${Math.min(98, (100 * s.maxByCategorySeen[c]) / lim)}%`;
      row.bar.classList.toggle('full', n >= lim);
      row.text.textContent = `${n}/${lim}`;
    }

    // Counters (per second over the last refresh interval).
    const totals: Record<string, number> = { played: e.played, stolen: e.stolen, events: e.events };
    for (const d of DROP_REASONS) totals[`drop:${d}`] = e.dropped[d];
    const dt = (nowMs - this.prevAt) / 1000;
    for (const row of this.counters) {
      const v = totals[row.key] ?? 0;
      row.total.textContent = String(v);
      if (this.prevTotals !== null && dt > 0) {
        const prev = this.prevTotals[row.key] ?? 0;
        row.perSec.textContent = v >= prev ? ((v - prev) / dt).toFixed(0) : '–';
      }
    }
    if (dt >= 0.9 || this.prevTotals === null) {
      this.prevTotals = totals;
      this.prevAt = nowMs;
    }

    // Timings.
    const setTiming = (key: string, t: { p50: number; p95: number; p99: number; max: number }): void => {
      const cells = this.timingRows.get(key)!;
      cells[0]!.textContent = fmt(t.p50);
      cells[1]!.textContent = fmt(t.p95);
      cells[2]!.textContent = fmt(t.p99);
      cells[3]!.textContent = fmt(t.max);
      cells[1]!.className = t.p95 > 0.5 ? 'n err' : 'n';
    };
    setTiming('engine', e.mainJs);
    setTiming('calls', s.engineCalls);
    setTiming('generator', s.generator);

    if (this.alertsDirty || nowMs - this.lastAlertRender > 1000) this.renderAlerts(nowMs);
  }

  private renderAlerts(nowMs: number): void {
    this.alertsDirty = false;
    this.lastAlertRender = nowMs;
    const list = el('alert-list');
    const items: HTMLLIElement[] = [];
    const history: AlertRecord[] = this.engine.alertHistory();
    for (const a of history) {
      const li = document.createElement('li');
      const text = document.createElement('span');
      const ago = Math.max(0, (nowMs - a.atMs) / 1000);
      text.append(a.kind.replace(/^alt_/, ''), ' ');
      const small = document.createElement('small');
      small.textContent = a.x !== null && a.z !== null ? `(${a.x.toFixed(0)}, ${a.z.toFixed(0)}) · vor ${ago.toFixed(0)} s` : `ohne Ort · vor ${ago.toFixed(0)} s`;
      text.append(small);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Springen';
      btn.className = 'jump';
      if (a.x === null || a.z === null) btn.disabled = true;
      else {
        const x = a.x;
        const z = a.z;
        btn.addEventListener('click', () => this.actions.jumpTo(x, z));
      }
      li.append(text, btn);
      items.push(li);
    }
    list.replaceChildren(...items);
  }
}
