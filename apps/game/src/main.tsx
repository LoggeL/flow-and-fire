/** Session entry: verified assets, genuine skirmish setup, sandbox and recorded replay workers. */
import AssetWorker from '@faf/client/asset-worker?worker';
import SimWorker from '@faf/sim-host/worker?worker';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { Op } from '@faf/protocol';
import { AssetManager, parsePresetName } from '@faf/client';
import { DEFAULT_SKIRMISH_RULES, validateSkirmish, type SkirmishConfig } from '@faf/hud';
import { computed, signal } from '@preact/signals';
import { render } from 'preact';
import { Game, type GameAssets } from './game.ts';
import { installTestHooks } from './hooks.ts';
import type { GameHudPorts } from './hud/live.ts';
import { FrontendMenus } from './hud/LiveHud.tsx';
import { INITIAL_LOAD_STATE, SIM_START_PROGRESS, type LoadState, type LoadTimings } from './loading.ts';
import { parseParams, type GameParams } from './params.ts';
import { ReplayController, ReplayLibrary, ReplayPanel, createReplayWorker, downloadReplay, transferredReplay, type RecordedGame, type ReplayAssets } from './replay/index.ts';
import { skirmishInitialization } from './session-setup.ts';
import { SessionAssetsStore, gameAssetsFromSession, type SessionMap } from './session-assets.ts';
import { storedSettings, uiLocale } from './session-settings.ts';
import { App, BootError } from './ui/App.tsx';
import { LoadingScreen } from './ui/LoadingScreen.tsx';

const root = document.documentElement;
root.dataset['build'] = __FAF_BUILD_HASH__;
root.dataset['coi'] = String(globalThis.crossOriginIsolated === true);
const parsedParams = parseParams(location.search);
const savedPreset = parsePresetName(storedSettings()?.preset ?? '');
const initialParams = new URLSearchParams(location.search).has('preset') || savedPreset === undefined ? parsedParams : { ...parsedParams, preset: savedPreset };
const params = signal<GameParams>(initialParams);
const load = signal<LoadState>(INITIAL_LOAD_STATE);
const gameSig = signal<Game | null>(null);
const assetsSig = signal<GameAssets | null>(null);
const mapsSig = signal<readonly SessionMap[]>([]);
const menuMaps = computed(() => mapsSig.value.map(map => map.menu));
const configSig = signal<SkirmishConfig | undefined>(undefined);
const replaySig = signal<ReplayController | null>(null);
const replayOpen = signal(false);
const actionError = signal<string | null>(null);
let manager: AssetManager;
let store: SessionAssetsStore;
let library: ReplayLibrary | null = null;
let timings: LoadTimings | null = null;
let generation = 0;
let starting = false;

function setLoad(state: LoadState): void {
  load.value = state;
  root.dataset['loadingProgress'] = String(state.progress);
}
function replayLibrary(): ReplayLibrary { return library ??= new ReplayLibrary(); }
function currentReplayAssets(): ReplayAssets {
  const assets = assetsSig.peek();
  if (assets === null) throw new Error('Spielinhalte sind noch nicht geladen.');
  return { simBin: assets.simBin, map: assets.mapBytes };
}
async function disposeSession(immediate = false): Promise<void> {
  generation++;
  delete root.dataset['ready'];
  const previous = gameSig.peek();
  replaySig.peek()?.dispose();
  replaySig.value = null;
  gameSig.value = null;
  if (immediate) previous?.dispose();
  else await previous?.close();
}
async function beforeHistoricalReplayNavigation(): Promise<void> {
  // disposeSession clears the signals; retain the bridge whose eager load must be cancelled.
  const previous = gameSig.peek();
  try { await disposeSession(); }
  finally { await previous?.audio.dispose(); }
}
let actionErrorTimer: ReturnType<typeof setTimeout> | null = null;
/** Session errors stay readable for five seconds, then clear like in-game action errors. */
function report(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  actionError.value = message;
  if (actionErrorTimer !== null) clearTimeout(actionErrorTimer);
  actionErrorTimer = setTimeout(() => { actionErrorTimer = null; if (actionError.peek() === message) actionError.value = null; }, 5000);
}

const ports: GameHudPorts = {
  startSkirmish(config) { void startSession(config).catch(report); },
  leaveGame() {
    void disposeSession().catch(report); replayOpen.value = false; actionError.value = null;
    setLoad({ ...load.peek(), phase: 'ready', progress: 100 });
  },
  openReplay() { replayLibrary(); replayOpen.value = true; },
  surrender() { const game=gameSig.peek(); if(game!==null&&!game.replayMode)game.client.commands.issue(Op.SelfDestruct,game.client.ownHandles(),new Uint8Array(0),false,performance.now()); },
  saveReplay() {
    const game = gameSig.peek();
    if (game === null || game.replayMode) return;
    const assets = currentReplayAssets();
    void game.exportLog(false).then(bytes => replayLibrary().convert(bytes, assets)).then(result => downloadReplay(result.bytes)).catch(report);
  },
  watchMatchReplay() {
    const game = gameSig.peek();
    if (game === null || game.replayMode) return;
    const assets = currentReplayAssets();
    void game.exportLog(false).then(bytes => replayLibrary().convert(bytes, assets)).then(result => startSession(undefined, result.bytes)).catch(report);
  },
  applySetting(key, value) {
    const game = gameSig.peek();
    if (game !== null) {
      const accepted = game.applySetting(key, value);
      const preset = key === 'preset' ? parsePresetName(String(value)) : undefined;
      if (accepted && preset !== undefined) params.value = { ...params.peek(), preset };
      return accepted;
    }
    if (['frameCap', 'renderScale', 'shadowCascades', 'splatLayers', 'particleCap', 'bloom', 'antialias', 'cameraShake', 'pauseInBackground', 'autoSaveReplays', 'volMaster', 'volSfx', 'volVoice', 'volUi', 'volMusic', 'volAmbient', 'alertVoice', 'audibleStall', 'audioInBackground'].includes(key)) return !(key === 'antialias' && value === 'msaa4') && !(key === 'splatLayers' && value === 2) && !(key === 'shadowCascades' && value === 3);
    if (key !== 'preset') return false;
    const preset = parsePresetName(String(value));
    if (preset === undefined) return false;
    params.value = { ...params.peek(), preset };
    gameSig.peek()?.setPreset(preset);
    return true;
  },
};

function defaultSkirmish(mapId: string): SkirmishConfig {
  return {
    mapId,
    slots: [
      // Colours are setup option ids; teams stay 0-based internally (shown as 1 and 2).
      { index: 0, name: 'Spieler', controller: 'human', faction: 'varkan', color: 'blue', team: 0, start: 0, ai: null },
      { index: 1, name: 'KI', controller: 'ai', faction: 'varkan', color: 'red', team: 1, start: 1, ai: { difficulty: 'normal', aix: false, aixFactor: 1 } },
    ],
    rules: { ...DEFAULT_SKIRMISH_RULES, seed: initialParams.seed },
  };
}
function Root() {
  const game = gameSig.value, state = load.value, assets = assetsSig.value;
  return <>
    {game !== null ? <App game={game} ports={ports} {...(game.result.value !== null ? { result: game.result.value } : {})}/> : state.phase === 'ready' ? <FrontendMenus ports={ports} maps={menuMaps.value} build={__FAF_BUILD_HASH__} {...(configSig.value !== undefined ? { initialConfig: configSig.value } : {})}/> : null}
    {(replayOpen.value || (game !== null && (game.replayMode || game.result.value === null))) && assets !== null ? <ReplayPanel library={replayLibrary()} controller={replaySig.value} open={replayOpen.value}
      assets={{ simBin: assets.simBin, map: assets.mapBytes }}
      exportCurrentLog={game !== null && !game.replayMode ? () => game.exportLog(false) : null}
      onOpen={bytes => startSession(undefined, bytes)} onExit={() => { ports.leaveGame(); }} resolveAssets={recordingAssets}
      locale={uiLocale.value} mapName={hash => mapsSig.value.find(map => map.simHash === hash)?.menu.name}
      beforeHistoricalNavigate={beforeHistoricalReplayNavigation}/> : null}
    {actionError.value !== null ? <div class="live-action-error" role="alert">{actionError.value}<button onClick={() => { actionError.value = null; }}>Schließen</button></div> : null}
    {state.phase !== 'ready' ? <LoadingScreen state={state} mapName={params.value.map}/> : null}
  </>;
}

/** Cancellation rejects outstanding startup promises when a menu replaces the session. */
function firstFrame(game: Game, id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (generation !== id) reject(new Error('Spielstart abgebrochen.'));
      else if (game.fatal.peek() !== null) reject(new Error(game.fatal.peek()!));
      else if (game.renderer.stats.lost) reject(new Error('WebGL-Kontext beim Spielstart verloren.'));
      else if (game.renderer.stats.frames > 0 && game.client.lastFrame !== null) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}
async function recordingAssets(recording: RecordedGame): Promise<ReplayAssets> {
  const map = mapsSig.peek().find(candidate => candidate.simHash === recording.mapSimHash);
  if (map === undefined) throw new Error(`Die aufgezeichnete Karte (${recording.mapSimHash.toString(16)}) fehlt in den lokalen Inhalten.`);
  const session = await store.load(map.menu.id, () => {});
  return { simBin: session.simBin, map: session.mapBytes };
}

async function startSession(config?: SkirmishConfig, replayBytes?: Uint8Array, autostart = true): Promise<void> {
  if (starting) throw new Error('Ein Spiel wird bereits geladen.');
  if (config !== undefined) {
    const problem = validateSkirmish(config, mapsSig.peek().map(map => map.menu));
    if (problem !== null) throw new Error(`Ungültiges Gefecht: ${problem}`);
  }
  starting = true;
  let id = generation;
  try {
    actionError.value = null;
    let sessionParams = initialParams;
    let replayInfo: Awaited<ReturnType<ReplayLibrary['inspect']>> | undefined;
    if (replayBytes !== undefined) {
      replayInfo = await replayLibrary().inspect(replayBytes);
      const map = mapsSig.peek().find(candidate => candidate.simHash === replayInfo!.head.mapSimHash);
      if (map === undefined) throw new Error('Die aufgezeichnete Karte ist hier nicht verfügbar.');
      sessionParams = { ...initialParams, map: map.menu.id, seed: replayInfo.game.seed, autostart: false };
    } else if (config !== undefined) {
      sessionParams = { ...initialParams, map: config.mapId, seed: config.rules.seed, autostart, spawn: 'none', cubes: 0, enemyCubes: 0, units: 0 };
    }
    sessionParams = { ...sessionParams, preset: params.peek().preset };
    const closing = disposeSession(); id = generation;
    await closing;
    if (id !== generation) throw new Error('Spielstart abgebrochen.');
    params.value = sessionParams;
    const session = await store.load(sessionParams.map, state => { if (id === generation) setLoad(state); });
    if (id !== generation) throw new Error('Spielstart abgebrochen.');
    const assets = gameAssetsFromSession(session);
    assetsSig.value = assets;
    setLoad({ ...load.peek(), phase: 'sim', progress: SIM_START_PROGRESS, asset: null, source: null });
    const canvas = document.getElementById('game-canvas'), gameRoot = document.getElementById('game-root');
    if (!(canvas instanceof HTMLCanvasElement) || gameRoot === null) throw new Error('Spieloberfläche fehlt.');
    const worker = replayBytes !== undefined ? createReplayWorker(replayBytes) : new SimWorker({ name: 'faf-sim' });
    if (replayBytes !== undefined) { replaySig.value = new ReplayController(worker, replayBytes); replayOpen.value = true; }
    const game = new Game({
      canvas, params: sessionParams, buildHash: __FAF_BUILD_HASH__, assets, createWorker: () => worker, root: gameRoot,
      ...(replayInfo !== undefined ? { replayMode: true, playerArmy: replayInfo.game.playerArmy, armyCount: Math.max(...replayInfo.game.armies.map(army => army.index)) + 1, ...(replayInfo.game.initialization !== undefined ? { initialization: replayInfo.game.initialization } : {}) } : {}),
      ...(config !== undefined ? { initialization: skirmishInitialization(config, decodeSimBin(new Uint8Array(assets.simBin))), skirmishConfig: config, armyCount: config.slots.length, playerArmy: config.slots.findIndex(slot => slot.controller === 'human') } : {}),
    });
    gameSig.value = game;
    configSig.value = config ?? configSig.peek();
    root.dataset['webgl2'] = 'ok'; root.dataset['transport'] = game.transport;
    installTestHooks(game, () => timings);
    await game.whenReady();
    const audio = await game.audio.ready;
    if (audio.failed > 0) throw new Error(`Soundbank konnte nicht vollständig geladen werden: ${audio.failed} Sounds fehlen.`);
    await firstFrame(game, id);
    if (config !== undefined && config.rules.startSpeed !== 1) game.ctl({ t: 'speed', speed: config.rules.startSpeed });
    timings = { ...session.timings, simStartMs: (game.readyAtMs ?? performance.now()) - game.initAtMs, navigationToReadyMs: performance.now() };
    setLoad({ ...load.peek(), phase: 'ready', progress: 100 }); root.dataset['ready'] = '1';
  } catch (error) {
    if (id === generation) {
      if (replaySig.peek()?.failure.peek() !== null && replaySig.peek() !== null) setLoad({ ...load.peek(), phase: 'ready', progress: 100 });
      else setLoad({ ...load.peek(), phase: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  } finally { starting = false; }
}

async function boot(): Promise<void> {
  const uiRoot = document.getElementById('ui-root');
  if (uiRoot === null) throw new Error('missing #ui-root');
  render(<Root/>, uiRoot);
  manager = new AssetManager({ manifestUrl: `${import.meta.env.BASE_URL}assets/manifest.json`, createWorker: () => new AssetWorker({ name: 'faf-assets' }) });
  store = new SessionAssetsStore(manager);
  const session = await store.load(initialParams.map, setLoad);
  assetsSig.value = gameAssetsFromSession(session);
  mapsSig.value = await store.maps();
  configSig.value = defaultSkirmish(mapsSig.peek().some(map => map.menu.id === initialParams.map) ? initialParams.map : mapsSig.peek()[0]?.menu.id ?? '');
  const transfer = transferredReplay(location.search), query = new URLSearchParams(location.search);
  if (transfer !== null) await startSession(undefined, transfer);
  else if (query.get('mode') === 'skirmish') await startSession(configSig.peek(), undefined, initialParams.autostart);
  else if (query.size > 0 && query.get('menu') !== '1') await startSession();
  else setLoad({ ...load.peek(), phase: 'ready', progress: 100 });
  if (import.meta.hot) {
    import.meta.hot.on('faf:blueprints', (payload: { simBin: number[]; viewJson: string; changedAt: number }) => gameSig.peek()?.reloadBlueprints(payload));
    import.meta.hot.on('faf:blueprint-error', (payload: { message: string }) => gameSig.peek()?.blueprintError(payload.message));
    import.meta.hot.dispose(() => { void disposeSession(true); library?.dispose(); manager.dispose(); });
  }
}
boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[faf] boot failed: ${message}`);
  root.dataset['webgl2'] = /webgl2/i.test(message) ? 'unavailable' : (root.dataset['webgl2'] ?? 'unknown');
  setLoad({ ...load.peek(), phase: 'error', message: `Start fehlgeschlagen: ${message}` });
  const uiRoot = document.getElementById('ui-root');
  if (uiRoot !== null && document.querySelector('[data-testid="loading-screen"]') === null) render(<BootError message={message}/>, uiRoot);
});
