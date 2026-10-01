import { BUS_IDS, DROP_REASONS, SOUND_CATEGORIES, FX_ONE, type AudioStats, type ListenerState, type SoundCategory, type AudioManifest, type TimingStats } from '@faf/audio';
import { createAudioEngine, timingStats } from '@faf/audio/engine';
import { loadManifest } from '@faf/audio/loader';
import { DEFAULT_EVENT_TYPES } from '@faf/audio/events';
import { BattleScenario, battleVisualName } from './demo/scenario.ts';
import { audioBaseUrl } from './shared/assets.ts';

export interface DemoOptions { shots?: number; seconds?: number; speed?: number; seed?: number }
export interface DemoStats { engine: AudioStats; scenario: { ticks: number; weaponFire: number; impacts: number; deaths: number; alerts: number; generator: TimingStats }; maxVoicesSeen: number; maxByCategorySeen: Record<SoundCategory, number>; categoryLimits: Record<SoundCategory, number>; camera: ListenerState; running: boolean }
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('field');
const ctx = canvas.getContext('2d')!;
const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => { const v = Number(params.get(key)); return params.has(key) && Number.isFinite(v) ? v : fallback; };
const camera: ListenerState = { focusX: 256, focusZ: 256, height: Math.max(20, Math.min(400, num('zoom', 90))), viewHalfWidth: 60, rightX: 1, rightZ: 0 };
let angle = 0;
let manifest: AudioManifest;
let scenario = new BattleScenario({ seconds: num('seconds', 120), fps: 60, shotsPerSecond: num('shots', 200), seed: num('seed', 1) });
let speed = Math.max(.25, Math.min(3, num('speed', 1)));
let running = false;
let simMs = 0;
let nextTickMs = 0;
let lastMs = 0;
let lastHud = 0;
let maxVoicesSeen = 0;
const maxByCategorySeen = Object.fromEntries(SOUND_CATEGORIES.map(c => [c, 0])) as Record<SoundCategory, number>;
const generatorTimes = new Float64Array(4096);
let generatorSamples = 0;
const effects = new Float32Array(2048 * 4);
let effectHead = 0;
const keys = new Set<string>();
let drag: { x: number; y: number } | null = null;
let previousStats: AudioStats | null = null;
const engine = createAudioEngine({ baseUrl: audioBaseUrl(), visualName: battleVisualName, unlockTarget: null, onJumpTo: (x, z) => { camera.focusX = x; camera.focusZ = z; applyCamera(); }, onAlert: a => {
  const row = document.createElement('div'); row.className = 'alert'; const text = document.createElement('span'); text.textContent = a.kind.replace('alt_', ''); row.append(text);
  if (a.x !== null && a.z !== null) { const button = document.createElement('button'); button.textContent = 'Springen'; button.onclick = () => { camera.focusX = a.x!; camera.focusZ = a.z!; applyCamera(); }; row.append(button); }
  el('alerts').prepend(row);
} });
function applyCamera(): void { camera.viewHalfWidth = camera.height * Math.tan(Math.PI / 6); camera.rightX = Math.cos(angle); camera.rightZ = Math.sin(angle); engine.setListener(camera); }
function stop(): void { running = false; engine.setLoop('build:left', null); engine.setLoop('build:right', null); }
function start(opts: DemoOptions = {}): void {
  stop(); speed = Math.max(.25, Math.min(3, opts.speed ?? speed));
  scenario = new BattleScenario({ seconds: opts.seconds ?? num('seconds', 120), fps: 60, shotsPerSecond: opts.shots ?? Number(el<HTMLInputElement>('shots').value), seed: opts.seed ?? num('seed', 1) });
  simMs = nextTickMs = 0; maxVoicesSeen = generatorSamples = 0; for (const c of SOUND_CATEGORIES) maxByCategorySeen[c] = 0;
  engine.resetStats(); engine.setSimSpeed(speed); engine.setLoop('build:left', { sound: 'bld_pour_loop', x: 232, z: 241 }); engine.setLoop('build:right', { sound: 'bld_pour_loop', x: 280, z: 251 }); running = true;
}
function stats(): DemoStats { return { engine: engine.stats(), scenario: { ...scenario.counts, generator: timingStats(generatorTimes, Math.min(generatorSamples, generatorTimes.length)) }, maxVoicesSeen, maxByCategorySeen: { ...maxByCategorySeen }, categoryLimits: Object.fromEntries(SOUND_CATEGORIES.map(c => [c, manifest?.categories[c].maxVoices ?? 0])) as Record<SoundCategory, number>, camera: { ...camera }, running }; }
const ready = loadManifest(`${audioBaseUrl()}manifest.json`).then(async m => {
  manifest = m;
  for (const c of SOUND_CATEGORIES) { const row = document.createElement('div'); row.className = 'category'; row.innerHTML = `<span>${c}</span><progress id="cat-${c}" max="${m.categories[c].maxVoices}" value="0"></progress><span id="count-${c}">0/${m.categories[c].maxVoices}</span>`; el('categories').append(row); }
  const report = await engine.load(); el('status').textContent = `Bereit · ${report.loaded} Sounds`; if (params.get('autostart') === '1') start();
});
declare global { interface Window { __fafAudioDemo: { ready: Promise<void>; start(opts?: DemoOptions): void; stop(): void; stats(): DemoStats; engine: typeof engine; setCamera(patch: Partial<ListenerState> & { angle?: number }): void } } }
window.__fafAudioDemo = { ready, start, stop, stats, engine, setCamera: patch => { Object.assign(camera, patch); if (patch.angle !== undefined) angle = patch.angle; else if (patch.rightX !== undefined || patch.rightZ !== undefined) angle = Math.atan2(camera.rightZ, camera.rightX); applyCamera(); } };
for (const bus of BUS_IDS) { const row = document.createElement('label'); row.className = 'bus'; row.textContent = bus; const input = document.createElement('input'); input.type = 'range'; input.id = `bus-${bus}`; input.min = '0'; input.max = '1'; input.step = '.01'; input.value = String(engine.settings.get()[bus]); input.oninput = () => engine.settings.set({ [bus]: Number(input.value) }); row.append(input); el('buses').append(row); }
el<HTMLInputElement>('mute').checked = engine.settings.get().muted;
el<HTMLInputElement>('mute').onchange = () => engine.settings.set({ muted: el<HTMLInputElement>('mute').checked });
el<HTMLButtonElement>('activate').onclick = () => { void engine.unlock().then(ok => { if (ok) { el('unlock').hidden = true; if (!running) start(); } }); };
el<HTMLButtonElement>('restart').onclick = () => { speed = Number(el<HTMLInputElement>('speed').value); start(); };
el<HTMLButtonElement>('stop').onclick = stop;
el<HTMLButtonElement>('ack').onclick = () => { engine.playUi('ack_pip_direct'); };
el<HTMLInputElement>('shots').value = String(scenario.cfg.shotsPerSecond); el<HTMLInputElement>('speed').value = String(speed);
window.addEventListener('keydown', e => { if (e.target instanceof HTMLInputElement) return; keys.add(e.key.toLowerCase()); if (e.code === 'Space') { e.preventDefault(); engine.jumpToLastAlert(); } }); window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
canvas.addEventListener('pointerdown', e => { if (e.button === 0) { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', e => { if (!drag) return; const scale = camera.viewHalfWidth * 2 / canvas.clientWidth; const dx = (drag.x - e.clientX) * scale; const dz = (drag.y - e.clientY) * scale; camera.focusX += dx * camera.rightX - dz * camera.rightZ; camera.focusZ += dx * camera.rightZ + dz * camera.rightX; drag.x = e.clientX; drag.y = e.clientY; applyCamera(); }); canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', e => { e.preventDefault(); camera.height = Math.max(20, Math.min(400, camera.height * Math.exp(e.deltaY * .001))); applyCamera(); }, { passive: false });
canvas.addEventListener('contextmenu', e => { e.preventDefault(); engine.playUi('ack_pip_direct'); engine.playUi('ui_cmd_move'); });
function render(now: number): void {
  const w = canvas.clientWidth, h = canvas.clientHeight; if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.fillStyle = '#19241f'; ctx.fillRect(0, 0, w, h); ctx.save(); ctx.translate(w / 2, h / 2); const scale = w / (camera.viewHalfWidth * 2); ctx.scale(scale, scale); ctx.rotate(-angle); ctx.translate(-camera.focusX, -camera.focusZ);
  ctx.strokeStyle = '#2c3d32'; ctx.lineWidth = 1 / scale; for (let v = 0; v <= 512; v += 16) { ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, 512); ctx.moveTo(0, v); ctx.lineTo(512, v); ctx.stroke(); }
  ctx.strokeStyle = '#8d9d76'; ctx.strokeRect(0, 0, 512, 512);
  for (let side = 0; side < 2; side++) { ctx.fillStyle = side ? '#d4a36a' : '#77b3ad'; for (let i = 0; i < 150; i++) { const x = 256 + (side ? 1 : -1) * (12 + (i % 10) * 3) + Math.sin(now / 2000 + i) * 2; const z = 204 + Math.floor(i / 10) * 7; ctx.fillRect(x - 1, z - 1, 2, 2); } }
  for (let i = 0; i < effects.length; i += 4) { const age = now - effects[i + 2]!; if (age < 0 || age > 500) continue; const type = effects[i + 3]!; ctx.globalAlpha = 1 - age / 500; ctx.fillStyle = type === DEFAULT_EVENT_TYPES.weaponFire ? '#fff6b1' : type === DEFAULT_EVENT_TYPES.unitDeath ? '#ef7a42' : '#bca37a'; ctx.beginPath(); ctx.arc(effects[i]!, effects[i + 1]!, type === DEFAULT_EVENT_TYPES.weaponFire ? 1.5 : 1 + age / 100, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore(); ctx.globalAlpha = 1;
}
function hud(st: AudioStats, elapsed: number): void {
  el('status').textContent = `${st.state} · ${st.voices}/32 Stimmen`; el('unlock').hidden = st.state === 'running';
  for (const c of SOUND_CATEGORIES) { const p = document.getElementById(`cat-${c}`) as HTMLProgressElement | null; if (p) { p.value = st.voicesByCategory[c]; el(`count-${c}`).textContent = `${p.value}/${p.max}`; } }
  const rate = (current: number, old: number): string => `${((current - old) * 1000 / elapsed).toFixed(1)}/s · ${current}`;
  el('counters').textContent = `played ${rate(st.played, previousStats?.played ?? 0)}\nstolen ${rate(st.stolen, previousStats?.stolen ?? 0)}\ntails ${st.tails}\n${DROP_REASONS.map(d => `${d}: ${rate(st.dropped[d], previousStats?.dropped[d] ?? 0)}`).join('\n')}`;
  const g = stats().scenario.generator; el('timing').textContent = `Engine p50/p95/p99: ${st.mainJs.p50.toFixed(3)} / ${st.mainJs.p95.toFixed(3)} / ${st.mainJs.p99.toFixed(3)} ms\nGenerator p50/p95/p99: ${g.p50.toFixed(3)} / ${g.p95.toFixed(3)} / ${g.p99.toFixed(3)} ms\nGeladen: ${st.loadedSounds}/${manifest?.sounds.length ?? '?'} · ${(st.decodedBytes / 1048576).toFixed(1)} MiB\nPfade: ${JSON.stringify(st.decodePaths)}\nLatenz Basis/Ausgabe: ${st.baseLatencyMs?.toFixed(2) ?? 'n/a'} / ${st.outputLatencyMs?.toFixed(2) ?? 'n/a'} ms\nKamera: ${camera.focusX.toFixed(1)}, ${camera.focusZ.toFixed(1)} · Höhe ${camera.height.toFixed(1)}`; previousStats = st;
}
function frame(now: number): void {
  const dt = Math.min(100, lastMs ? now - lastMs : 0); lastMs = now;
  const oldX = camera.focusX, oldZ = camera.focusZ, oldAngle = angle;
  const pan = dt * camera.height / 1000; if (keys.has('a') || keys.has('arrowleft')) camera.focusX -= pan; if (keys.has('d') || keys.has('arrowright')) camera.focusX += pan; if (keys.has('w') || keys.has('arrowup')) camera.focusZ -= pan; if (keys.has('s') || keys.has('arrowdown')) camera.focusZ += pan; if (keys.has('q')) angle -= dt / 1000; if (keys.has('e')) angle += dt / 1000;
  // Spatial gains only need refreshing when the listener changes.
  if (camera.focusX !== oldX || camera.focusZ !== oldZ || angle !== oldAngle) applyCamera();
  if (running) { simMs += dt * speed; while (nextTickMs <= simMs && nextTickMs < scenario.cfg.seconds * 1000) { const t0 = performance.now(); const batch = scenario.nextTick(); generatorTimes[generatorSamples++ % generatorTimes.length] = performance.now() - t0; engine.handleEvents(batch); for (let i = 0; i < batch.count; i++) { const e = batch.events[i]!; const k = (effectHead++ % 2048) * 4; effects[k] = e.x / FX_ONE; effects[k + 1] = e.z / FX_ONE; effects[k + 2] = now; effects[k + 3] = e.type; } nextTickMs += 100; } if (simMs >= scenario.cfg.seconds * 1000) stop(); }
  engine.update(now); const st = engine.stats(); maxVoicesSeen = Math.max(maxVoicesSeen, st.voices); for (const c of SOUND_CATEGORIES) maxByCategorySeen[c] = Math.max(maxByCategorySeen[c], st.voicesByCategory[c]); render(now); if (now - lastHud >= 500) { hud(st, now - lastHud); lastHud = now; } requestAnimationFrame(frame);
}
ready.catch((e: unknown) => { el('status').textContent = String(e); el('status').classList.add('error'); }); applyCamera(); requestAnimationFrame(frame);
