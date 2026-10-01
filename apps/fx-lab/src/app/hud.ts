/**
 * DOM overlay of the fx-lab: scene and preset selection, toggles (hdr/bloom/csm/fxaa/fx/flight),
 * buttons (big explosion, context loss), live stats (text refreshed 4×/s) and projected scene labels.
 * Not created with `bench=1`.
 */
import { RENDER_PRESET_NAMES } from '@faf/render';
import type { RenderPresetName, RtsCamera } from '@faf/render';
import type { LabParams, SceneName } from './context.ts';
import { SCENE_NAMES } from './context.ts';
import type { FxLabStats, SegmentRecord } from './hooks.ts';
import { LAB_SEGMENTS } from './hooks.ts';

export type LabToggle = 'hdr' | 'bloom' | 'csm' | 'fxaa' | 'fx' | 'flight';
const TOGGLES: readonly LabToggle[] = ['hdr', 'bloom', 'csm', 'fxaa', 'fx', 'flight'];

export interface HudActions {
  setScene(name: SceneName): void;
  setPreset(name: RenderPresetName): void;
  setToggle(name: LabToggle, on: boolean): void;
  bigExplosion(): void;
  loseContext(): void;
}

/** Per-frame numbers the HUD averages. */
export interface HudFrame {
  frameMs: number;
  mainJsMs: number;
  fxJsMs: number;
  labJsMs: number;
  t: number;
}

export interface HudLabel {
  readonly text: string;
  readonly xWu: number;
  readonly yWu: number;
  readonly zWu: number;
}

const REFRESH_MS = 250;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function ms(v: number | null): string {
  return v === null || !Number.isFinite(v) ? 'n/v' : v.toFixed(2);
}

export class LabHud {
  private readonly root: HTMLElement;
  private readonly labelLayer: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly sceneButtons = new Map<SceneName, HTMLButtonElement>();
  private readonly toggleInputs = new Map<LabToggle, HTMLInputElement>();
  private readonly labelPool: HTMLElement[] = [];
  private readonly proj = new Float64Array(4);
  private lastRefresh = -Infinity;
  private accFrames = 0;
  private accFrameMs = 0;
  private accMain = 0;
  private accFx = 0;
  private accLab = 0;

  constructor(
    container: HTMLElement,
    params: LabParams,
    available: (name: SceneName) => boolean,
    private readonly actions: HudActions,
  ) {
    this.root = el('div', 'hud');
    this.labelLayer = el('div', 'hud-labels');
    container.append(this.labelLayer, this.root);

    this.root.append(el('div', 'hud-title', 'Flow & Fire · FX-Lab'));
    const scenes = el('div', 'hud-row');
    for (const name of SCENE_NAMES) {
      const b = el('button', 'hud-btn', name);
      b.disabled = !available(name);
      b.title = b.disabled ? 'noch nicht verfügbar' : `Szene ${name}`;
      b.addEventListener('click', () => this.actions.setScene(name));
      scenes.append(b);
      this.sceneButtons.set(name, b);
    }
    this.root.append(scenes);

    const presetRow = el('div', 'hud-row');
    presetRow.append(el('span', 'hud-key', 'Preset'));
    const sel = el('select', 'hud-select');
    for (const p of RENDER_PRESET_NAMES) {
      const o = el('option', undefined, p);
      o.value = p;
      o.selected = p === params.preset;
      sel.append(o);
    }
    sel.addEventListener('change', () => this.actions.setPreset(sel.value as RenderPresetName));
    presetRow.append(sel);
    this.root.append(presetRow);

    const toggles = el('div', 'hud-row');
    for (const t of TOGGLES) {
      const label = el('label', 'hud-toggle');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = params[t];
      input.addEventListener('change', () => this.actions.setToggle(t, input.checked));
      label.append(input, document.createTextNode(t));
      toggles.append(label);
      this.toggleInputs.set(t, input);
    }
    this.root.append(toggles);

    const buttons = el('div', 'hud-row');
    const big = el('button', 'hud-btn', 'Big Explosion');
    big.addEventListener('click', () => this.actions.bigExplosion());
    const lose = el('button', 'hud-btn', 'Context verlieren');
    lose.addEventListener('click', () => this.actions.loseContext());
    buttons.append(big, lose);
    this.root.append(buttons);

    this.statsEl = el('pre', 'hud-stats');
    this.errorEl = el('pre', 'hud-error');
    this.errorEl.hidden = true;
    this.root.append(this.statsEl, this.errorEl);
    this.setScene(params.scene);
  }

  setScene(name: SceneName): void {
    for (const [n, b] of this.sceneButtons) b.classList.toggle('active', n === name);
  }

  setToggle(name: LabToggle, on: boolean): void {
    const i = this.toggleInputs.get(name);
    if (i !== undefined) i.checked = on;
  }

  showError(msg: string | null): void {
    this.errorEl.hidden = msg === null;
    this.errorEl.textContent = msg ?? '';
  }

  /** Accumulates a frame; refreshes the text at most every 250 ms (stats() is only called then). */
  frame(f: HudFrame, nowMs: number, stats: () => FxLabStats, gpu: SegmentRecord<number | null>, restoreCount: number): void {
    this.accFrames++;
    this.accFrameMs += f.frameMs;
    this.accMain += f.mainJsMs;
    this.accFx += f.fxJsMs;
    this.accLab += f.labJsMs;
    if (nowMs - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = nowMs;
    const n = Math.max(1, this.accFrames);
    const frameMs = this.accFrameMs / n;
    const s = stats();
    const lines: string[] = [];
    lines.push(`t ${f.t.toFixed(2)} s   FPS ${frameMs > 0 ? (1000 / frameMs).toFixed(1) : '–'}   Frame ${frameMs.toFixed(2)} ms`);
    lines.push(`JS main ${(this.accMain / n).toFixed(2)}  fx ${(this.accFx / n).toFixed(2)}  lab ${(this.accLab / n).toFixed(2)} ms`);
    const seg = LAB_SEGMENTS.map((k) => `${k} ${s.drawsBySeg[k]}`).join(' · ');
    lines.push(`Draws ${s.draws}  (${seg})`);
    lines.push(`GPU ${s.gpuTimer ? LAB_SEGMENTS.map((k) => `${k} ${ms(gpu[k])}`).join(' · ') : 'n/v (kein Timer-Query)'}`);
    const p = s.fx.particles;
    lines.push(
      p === null
        ? 'Partikel –'
        : `Partikel ${p.alive}/${p.cap} (Ring ${p.capacity})  dropped ${p.dropped.join('/')}  culled ${p.culled}`,
    );
    if (s.fx.shields !== null) lines.push(`Schilde ${s.fx.shields.count}  Ripples ${s.fx.shields.ripplesActive}`);
    lines.push(`Beams ${s.fx.beams}  Trails ${s.fx.trails}  Units ${s.units}  Decals ${s.decals.count}/${s.decals.cap}`);
    lines.push(
      `Post ${s.post.hdr ? 'HDR' : 'LDR'} bloom ${s.post.levels} fxaa ${s.post.fxaa ? 'an' : 'aus'}  CSM ${s.csm.enabled ? `an (static ${s.csm.staticRefreshes})` : 'aus'}  Shake ${s.shakeActive ? 'aktiv' : '–'}`,
    );
    lines.push(`Canvas ${s.canvas[0]}×${s.canvas[1]}  Restores ${restoreCount}`);
    const sc = Object.entries(s.scene);
    if (sc.length > 0) lines.push(`Szene: ${sc.map(([k, v]) => `${k} ${Number.isInteger(v) ? v : v.toFixed(2)}`).join(' · ')}`);
    this.statsEl.textContent = lines.join('\n');
    this.accFrames = 0;
    this.accFrameMs = 0;
    this.accMain = 0;
    this.accFx = 0;
    this.accLab = 0;
  }

  /** Positions the scene labels (camera viewport = CSS pixels). */
  labels(list: readonly HudLabel[], camera: RtsCamera): void {
    const pool = this.labelPool;
    while (pool.length < list.length) {
      const d = el('div', 'hud-label');
      this.labelLayer.append(d);
      pool.push(d);
    }
    for (let i = 0; i < pool.length; i++) {
      const d = pool[i]!;
      const l = list[i];
      if (l === undefined) {
        d.hidden = true;
        continue;
      }
      const visible = camera.project(l.xWu * 4096, l.yWu * 4096, l.zWu * 4096, this.proj);
      const x = this.proj[0]!;
      const y = this.proj[1]!;
      if (!visible || x < -200 || y < -50 || x > camera.viewportWidth + 200 || y > camera.viewportHeight + 50) {
        d.hidden = true;
        continue;
      }
      d.hidden = false;
      if (d.textContent !== l.text) d.textContent = l.text;
      d.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  destroy(): void {
    this.root.remove();
    this.labelLayer.remove();
  }
}
