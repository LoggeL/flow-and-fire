/** Live HUD adapter. Simulation state comes exclusively from the accepted frame. */
import { COMMANDER_ENHANCEMENTS, commanderEnhancementAdded, commanderEnhancementCostId, commanderEnhancementMask, commanderEnhancementTarget, type CommanderEnhancementId, type CommanderEnhancementSlot } from '@faf/rules';
import { batch, effect, signal } from '@preact/signals';
import { ActionMap, buildDragGrid, interpolatedPos, type Action, type BuildGesture } from '@faf/client';
import { UnitFlags, EcoField, FrameFlags, WatchOrderType, Op, encodeMove, encodeTarget, encodeFactoryQueue, encodeFactoryQueueEdit, encodeTogglePause, type FrameReader } from '@faf/protocol';
import { terrainCell } from '@faf/nav';
import { canPlace, footprintWidth, footprintHeight, PlacementVerdict, type PlacementWorld } from '@faf/rules';
import {
  COMMAND_NAMES, DEFAULT_SETTINGS, ORDER_IDS, aggregateMultiStats, cardSpec, createHudModel,
  findUnit, nextHotbuildTier, autoScale, resolveGridKey, validateSettings, validateSkirmish,
  type HudCommands, type HudModel, type MenuScreen, type SettingKey, type SettingsValues,
  mergeQueue, t, SLOT_CODES, type CardCellSpec, type SkirmishConfig, type SkirmishMap, type SlotCode, type ClickMods, type OrderEntry, type OrderId,
} from '@faf/hud';
import type { Game } from '../game.ts';
import { hudTypeId, simTypeId } from './type-ids.ts';
import { buildRole, type BuildRole } from './build-role.ts';
import { scoreFromStats } from './score.ts';
import { loadLastMatch, saveLastMatch } from '../last-match.ts';
import { detectGpu, recommendPreset } from '../gpu-info.ts';
import { presetSettings } from '../preset-settings.ts';
import { parsePresetName } from '@faf/render';

const ERROR_VISIBLE_MS = 5000;
const MESSAGES = {
  invalidSetting: ['Dieser Wert ist nicht zulässig.', 'This value is not allowed.'],
  settingUnsupported: ['Diese Einstellung wird hier nicht unterstützt.', 'This setting is not supported here.'],
  unavailable: ['Diese Aktion ist hier nicht verfügbar.', 'This action is not available here.'],
  noBuilder: ['Keine ausgewählte Einheit kann das bauen.', 'No selected unit can build this.'],
  noFactory: ['Keine fertige Fabrik ausgewählt.', 'No completed factory selected.'],
  noEligibleFactory: ['Keine ausgewählte Fabrik kann das bauen.', 'No selected factory can build this.'],
  invalidCount: ['Ungültige Anzahl.', 'Invalid count.'],
  noTarget: ['Kein sichtbares passendes Ziel.', 'No visible valid target.'],
} as const;
import { LOCAL_SETTINGS, restoreSettings, uiLocale } from '../session-settings.ts';
import { FrameHudAlerts } from './alerts.ts';
import { frameFlowConsumers, frameFactoryAssistance } from './flow.ts';
import { FrameBuildIntents, equalQueuedGhosts, type QueuedBuildGhost } from './build-intents.ts';
import { WorldCursor, gameCursor, type GameCursor } from '../cursors.ts';
import { completedFactoryHandles, contextOrders, contextTarget } from './context-orders.ts';
export { restoreSettings } from '../session-settings.ts';

export interface GameHudPorts {
  startSkirmish(config: SkirmishConfig): void;
  leaveGame(): void;
  openReplay?(): void;
  surrender?(): void;
  applySetting?<K extends SettingKey>(key: K, value: SettingsValues[K]): boolean;
  saveReplay?(): void;
  /** Converts the finished live match and opens it in the replay player. */
  watchMatchReplay?(): void;
}
export interface UpgradeWorkState {
  readonly handle: number; readonly currentTypeId: string; readonly targetTypeId: string | null;
  readonly active: boolean; readonly queued: boolean;
  readonly progress: number; readonly paused: boolean; readonly stalled: boolean; readonly enabled: boolean; readonly controllable: boolean;
  readonly mass: number; readonly energy: number; readonly buildPower: number; readonly hpMax: number;
  readonly targetBuildPower: number; readonly targetHpMax: number; readonly remainingS: number | null;
}
export interface CommanderEnhancementState {
  readonly id: CommanderEnhancementId; readonly slot: CommanderEnhancementSlot;
  readonly installed: boolean; readonly enabled: boolean; readonly targetTypeId: string | null;
  readonly mass: number; readonly energy: number; readonly buildTime: number;
  readonly targetBuildPower: number; readonly targetHpMax: number;
  readonly targetWeaponRange: number; readonly targetWeaponDps: number;
}
export interface CommanderUpgradeState extends UpgradeWorkState {
  readonly stage: 'base' | 'engineering' | 'armored';
  readonly enhancements: readonly CommanderEnhancementState[];
  readonly activeEnhancementId: CommanderEnhancementId | null;
  readonly weaponRange: number; readonly weaponDps: number;
}
export type { CommanderEnhancementId, CommanderEnhancementSlot } from '@faf/rules';
export interface ExtractorUpgradeState extends UpgradeWorkState {
  readonly tier: number; readonly targetTier: number | null;
  readonly massIncome: number; readonly targetMassIncome: number;
  readonly energyUpkeep: number; readonly targetEnergyUpkeep: number;
}
export interface FactoryUpgradeState extends UpgradeWorkState {
  readonly tier: number; readonly targetTier: number | null;
  /** HUD type ids of mobile units only the successor can produce. */
  readonly unlocks: readonly string[];
}
export interface PausedSelectionState { readonly count: number; readonly total: number; readonly controllable: boolean }
/** Commander successor blueprints share the base command card and roster capabilities. */
function presentationUnit(id: string) {
  return findUnit(id) ?? (id.startsWith('core:cmd_commander_') ? findUnit('core:cmd_commander') : undefined);
}

export interface MatchResult { readonly verdict: 'victory' | 'defeat' | 'draw'; readonly durationS: number }
export interface BuildGhost {
  readonly bp: number; readonly typeId: string; readonly x: number; readonly z: number;
  readonly yaw: number; readonly verdict: number; readonly corners: readonly (readonly [number, number])[];
  /** Projected roof corners of the class volume preview (same order as corners); empty if clipped. */
  readonly roof?: readonly (readonly [number, number])[];
  readonly role?: BuildRole;
}
/** Preview volume heights (WU) per build role; a readable massing, not a model claim. */
const PREVIEW_HEIGHT_WU: Partial<Record<BuildRole, number>> = { mass: 1.6, energy: 2.6, storage: 2.2, factory: 3.2, radar: 5, defense: 2.8 };
const ORDER_CURSORS: Partial<Record<OrderId | 'rally', GameCursor>> = { move: 'move', rally: 'move', attack: 'attack', attackGround: 'attack', tapshot: 'attack', patrol: 'patrol', assist: 'assist', repair: 'repair', reclaim: 'reclaim' };
export function gridActionMap(wasd = false): ActionMap {
  return new ActionMap(wasd ? {} : {
    panForward: [{ code: 'ArrowUp', anyModifiers: true }], panBack: [{ code: 'ArrowDown', anyModifiers: true }],
    panLeft: [{ code: 'ArrowLeft', anyModifiers: true }], panRight: [{ code: 'ArrowRight', anyModifiers: true }], stop: [{ code: 'KeyS', alt: true }], clearSelection: [],
  });
}
export class GameHudController {
  readonly model: HudModel = createHudModel();
  readonly screen = signal<MenuScreen>('game');
  readonly error = signal<string | null>(null);
  readonly ghost = signal<BuildGhost | null>(null);
  /** Proposed sites only; queuedGhosts below remains authoritative accepted Frame data. */
  readonly dragGhosts = signal<readonly BuildGhost[]>([]);
  private dragAnchor: BuildGhost | null = null;
  private dragEnd: { x: number; z: number } | null = null;
  private dragHandles: number[] = [];
  private dragSelection: number[] = [];
  private dragPickValid = false;
  private readonly buildGesture = (gesture: BuildGesture): void => this.onBuildGesture(gesture);
  readonly queuedGhosts = signal<readonly QueuedBuildGhost[]>([]);
  private readonly frameBuildIntents = new FrameBuildIntents();
  readonly result = signal<MatchResult | null>(null);
  readonly commanderUpgrade = signal<CommanderUpgradeState | null>(null);
  readonly extractorUpgrade = signal<ExtractorUpgradeState | null>(null);
  readonly factoryUpgrade = signal<FactoryUpgradeState | null>(null);
  /** Own paused units in the current selection; foreign or replay units are never offered. */
  readonly pausedSelection = signal<PausedSelectionState | null>(null);
  /** The presented viewer has an economy record; false for the all-armies replay view (no 0/0 bar). */
  readonly ecoAvailable = signal(true);
  readonly commands: HudCommands;
  private placement: { bp: number; typeId: string; slot: SlotCode; yaw: number } | null = null;
  private armedOrder: OrderId | 'rally' | null = null;
  private destructAt = 0;
  private destructHandles: number[] = [];
  private placementWorld: PlacementWorld | null = null;
  private lastSelection = '';
  private lastDataAt = -Infinity;
  private lastStatusAt = -Infinity;
  private lastEcoAt = -Infinity;
  private lastMinimapFogAt = -Infinity;
  private lastMinimapFogEpoch = -1;
  private lastViewer = -128;
  private lastPresentedTick = -1;
  private minimapFogCells = new Uint8Array(0);
  private lastFootprintSeq = -1;
  private flashUntil = 0;
  private readonly frameAlerts: FrameHudAlerts | null;
  private readonly worldCursor: WorldCursor;
  private readonly cursorPoint = new Float64Array(4);
  private readonly contextPosition = new Float64Array(3);
  private readonly contextPixel = new Float64Array(4);
  private cursorQuery = { x: NaN, y: NaN, camera: -1, seq: -1, viewer: -128, handle: -1 };
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposers: (() => void)[] = [];
  constructor(readonly game: Game | null, readonly ports?: GameHudPorts) {
    const m = this.model;
    this.disposers.push(effect(() => { void this.screen.value; this.error.value = null; }));
    const stats = game?.matchStats;
    if (stats) this.disposers.push(effect(() => { void stats.value; this.applyScore(); }));
    this.worldCursor = new WorldCursor(game?.canvas ?? null);
    this.frameAlerts = game ? new FrameHudAlerts(m.alerts, visual => {
      const typeId = this.typeId(visual), categories = presentationUnit(typeId)?.categories ?? [];
      return { typeId, commander: categories.includes('COMMAND'), structure: categories.includes('STRUCTURE') };
    }, game.map.sizeWu) : null;
    const gpu = detectGpu();
    m.menus.settings.gpuName.value = gpu.name ?? '';
    m.menus.settings.previewAvailable.value = game !== null;
    m.menus.main.replaysAvailable.value = ports?.openReplay !== undefined;
    if (!game) { const last = loadLastMatch(); m.menus.main.lastMatch.value = last === null ? null : { ...last, hasReplay: ports?.openReplay !== undefined }; }
    const settings = game?.runtimeSettings ?? restoreSettings();
    m.menus.settings.values.value = settings;
    m.locale.value = settings.locale;
    m.keyboardLayout.value = settings.locale;
    m.teams.value = settings.teamColors;
    m.reducedMotion.value = settings.reducedMotion;
    if (settings.uiScale !== 'auto') m.scale.value = settings.uiScale;
    const unavailable = (_name: string) => this.say('unavailable');
    // Every unsupported operation is explicit. No recording or demo adapter enters the game.
    const entries = Object.fromEntries(COMMAND_NAMES.map(name => [name, () => unavailable(name)]));
    this.commands = Object.assign(entries, {
      navigate: (screen: MenuScreen) => { if (screen === 'replays') { this.invoke('openReplay'); return; } this.screen.value = screen; },
      setLocale: (locale: 'de' | 'en') => this.setSetting('locale', locale),
      // A recommendation from GPU name and cores, applied like a preset choice; no benchmark claim.
      previewAudio: () => { game?.audio.preview(); },
      requestAutodetect: () => { m.menus.settings.detectState.value = 'running'; this.setSetting('preset', recommendPreset(gpu)); m.menus.settings.detectState.value = 'done'; },
      startSkirmish: (config: SkirmishConfig) => { const issue = validateSkirmish(config, m.menus.skirmish.maps.peek()); if (issue) { this.fail(t(issue as never)); return; }
        if (!this.ports) { unavailable('startSkirmish'); return; } this.ports.startSkirmish(config); },
      updateSkirmish: (patch: Partial<SkirmishConfig>) => { if (patch.mapId !== undefined) m.menus.skirmish.selectedMap.value = patch.mapId; if (patch.slots) m.menus.skirmish.slots.value = patch.slots; if (patch.rules) m.menus.skirmish.rules.value = patch.rules; },
      backToMenu: () => { this.screen.value = game ? 'game' : 'main'; m.menus.gameMenu.open.value = false; },
      quitToMenu: () => this.invoke('leaveGame'),
      surrender: () => this.invoke('surrender'),
      resume: () => { m.menus.gameMenu.open.value = false; this.screen.value = 'game'; },
      openGameMenu: () => { this.cancelMode(); m.menus.gameMenu.open.value = true; },
      togglePause: () => { game?.client.input.cancelBuildGesture(); game?.client.togglePause(); },
      changeSpeed: (delta: number) => { if (game) game.client.setSpeed(Math.max(.25, Math.min(3, game.client.speed + delta * .25))); },
      setSetting: <K extends SettingKey>(key: K, value: SettingsValues[K]) => this.setSetting(key, value),
      resetSettings: () => { for (const key of ['preset', 'renderScale', 'shadowCascades', 'splatLayers', 'particleCap', 'bloom', 'antialias', 'frameCap', 'cameraShake', 'volMaster', 'volSfx', 'volVoice', 'volUi', 'volMusic', 'volAmbient', 'alertVoice', 'audibleStall', 'audioInBackground', 'locale', 'uiScale', 'reducedMotion', 'teamColors', 'edgePan', 'keyScheme', 'pauseInBackground', 'autoSaveReplays'] as const) this.setSetting(key, DEFAULT_SETTINGS[key]); },
      saveReplay: () => { if (this.ports?.saveReplay) this.ports.saveReplay(); else if (game) void game.exportLog().catch(e => this.fail(String(e))); else unavailable('saveReplay'); },
      // From the score screen, open the finished match itself; elsewhere the recording library.
      watchReplay: () => { if (game && !game.replayMode && this.result.peek() !== null && this.ports?.watchMatchReplay) this.ports.watchMatchReplay(); else this.invoke('openReplay'); },
      rematch: () => this.commands.startSkirmish(this.config()),
      toggleFlowDetails: () => { m.eco.detailsOpen.value = !m.eco.detailsOpen.peek(); },
      jumpToAlert: (id: number) => this.jumpToAlert(id),
      cycleAlerts: () => { const item = this.frameAlerts?.cycle(); if (item) this.jumpToAlert(item.id); },
      cancelMode: () => this.cancelMode(),
      setTab: (tier: 1 | 2 | 3) => { m.card.tab.value = tier; },
      cardActivate: (slot: SlotCode, mods: ClickMods) => this.cardActivate(slot, mods),
      activateOrder: (id: OrderId) => this.activateOrder(id),
      queueAdd: (id: string, count: number, front: boolean) => this.queueAdd(id, count, front),
      queueRemove: (id: string, count: number) => this.queueRemove(id, count),
      clearQueue: () => this.factoryIssue(Op.FactoryQueueEdit, encodeFactoryQueueEdit({action:0,index:0,bp:0,count:0})),
      toggleRepeat: () => this.factoryIssue(Op.FactoryRepeat, Uint8Array.of(m.factory.queue.peek()?.repeat ? 0 : 1)),
      togglePauseProduction: () => this.factoryIssue(Op.TogglePause, encodeTogglePause(!m.factory.queue.peek()?.paused)),
      armRally: () => { const frame = game?.client.lastFrame;
        if (!game || !frame || game.client.readOnlyCommands || completedFactoryHandles(frame, game.bp, game.client.selection.selected(), game.client.playerArmy).length === 0) return;
        this.update(); this.cancelMode(); this.armedOrder = 'rally'; this.updateOrders(); },
      pauseConsumer: (handle: number, paused: boolean) => game?.client.commands.issue(Op.TogglePause,[handle],encodeTogglePause(paused),false,performance.now()),
      setCamera: (x: number, z: number) => game?.client.jumpTo(x * 4096, z * 4096),
      minimapOrder: (x: number, z: number, shift: boolean) => this.issueGroundOrder(x * 4096, z * 4096, shift),
      setMinimapMode: (mode: 'terrain' | 'tactical') => { m.minimap.mode.value = mode; },
      toggleResources: () => { m.minimap.showResources.value = !m.minimap.showResources.peek(); },
      showWholeMap: () => { if (game) game.client.jumpTo(game.map.sizeWu * 2048, game.map.sizeWu * 2048, game.client.camera.maxDistance); },
      selectType: (typeId: string) => this.selectByType(typeId, 'only'),
      deselectType: (typeId: string) => this.selectByType(typeId, 'remove'),
      selectDamagedOfType: (typeId: string) => this.selectByType(typeId, 'damaged'),
      focusType: (id: string) => { m.selection.focusTypeId.value = id; },
      selectUnit: (handle: number, mods: ClickMods) => { if (!game || mods.button === 2) return; const current = Array.from(game.client.selection.selected());
        if(mods.ctrl) {const r=game.client.lastFrame;const index=r?Array.from({length:r.unitCount},(_,i)=>i).find(i=>r.unitHandle(i)===handle):undefined; if(r&&index!==undefined)this.selectByType(game.bp.ids[r.unitVisual(index)]!,'only');return;}
        game.client.selectHandles(mods.shift ? current.filter(h => h !== handle) : [handle]); this.update(true); },
      jumpToOrder: (index: number) => { const order = m.selection.single.peek()?.orders[index]; if (order) game?.client.jumpTo(order.x * 4096, order.z * 4096); },
      saveGroup: (index: number, add: boolean) => { if (game) { game.client.controlGroups.save((index + 1) % 10, game.client.selection.selected(), add); this.update(true); } },
      recallGroup: (index: number, mods: ClickMods) => { if (!game) return; const center = game.client.controlGroups.recall((index + 1) % 10, game.client.selection, game.client.lastFrame, mods.shift, performance.now());
        game.client.selectHandles(game.client.selection.selected()); if (center) game.client.jumpTo(center.x, center.z); this.update(true); },
      filter: (kind: string, shift: boolean) => this.filter(kind, shift),
      selectIdleEngineer: (all: boolean) => this.selectIdle('ENGINEER', all),
      selectIdleFactory: () => this.selectIdle('FACTORY', false),
    }) as unknown as HudCommands;
    if (game) {
      if (game.skirmishConfig !== undefined) {
        const config=game.skirmishConfig;
        this.setMaps([{id:config.mapId,name:game.map.name,sizeWu:game.map.sizeWu,starts:game.map.starts.length,massSpots:game.map.spots.filter(spot=>spot.kind==='mass').length,hydroSpots:game.map.spots.filter(spot=>spot.kind!=='mass').length,available:true,startPositions:game.map.starts.map(start=>[start.x/(game.map.sizeWu*4096),start.z/(game.map.sizeWu*4096)] as const)}],config);
      }
      game.client.input.actions = gridActionMap(settings.keyScheme === 'wasd');
      game.client.input.edgePanEnabled = settings.edgePan;
      game.client.setActionInterceptor(action => this.worldAction(action));
      m.match.replay.value = game.replayMode;
      m.match.unitCap.value = game.unitCap;
      m.menus.main.build.value = game.buildHash;
      m.menus.main.transport.value = game.transport;
      m.menus.main.preset.value = game.params.preset;
      const size = game.map.sizeWu, input = { ...game.map.heightfield, waterLevelRaw: game.map.waterLevelRaw };
      const terrainCells = new Uint8Array(size * size);
      for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) terrainCells[z * size + x] = terrainCell(input, x, z);
      const spots = new Int32Array(game.map.spots.length * 3);
      game.map.spots.forEach((spot, i) => { spots[i * 3] = spot.kind === 'mass' ? 0 : 1; spots[i * 3 + 1] = spot.x; spots[i * 3 + 2] = spot.z; });
      this.placementWorld = { terrain: game.map.heightfield, waterLevelRaw: game.map.waterLevelRaw, terrainCells, footprints: new Uint8Array(size * size), spots, spotCount: game.map.spots.length };
      const res=Math.min(128,size),rgba=new Uint8ClampedArray(res*res*4);
      for(let z=0;z<res;z++)for(let x=0;x<res;x++){const ground=game.map.heightAtRaw((x+.5)*size/res*4096,(z+.5)*size/res*4096),water=game.map.waterLevelRaw!==null&&ground<game.map.waterLevelRaw;
        const elevation=(ground-game.map.minHeightRaw)/Math.max(1,game.map.maxHeightRaw-game.map.minHeightRaw);const base=water?30:65+Math.round(elevation*100),offset=(z*res+x)*4;
        rgba[offset]=water?25:base;rgba[offset+1]=water?55:base+10;rgba[offset+2]=water?80:base-12;rgba[offset+3]=255;}
      m.minimap.terrain.value={width:res,height:res,rgba};
      m.minimap.mapName.value = game.map.name; m.minimap.mapSizeWu.value = size; m.minimap.available.value = true;
      m.minimap.spots.value = game.map.spots.map(spot => ({ x: spot.x / 4096, z: spot.z / 4096, kind: spot.kind, taken: false }));
      this.update(true);
    }
  }
  showResult(result: MatchResult): void {
    const s = this.model.menus.score;
    const first = this.result.peek() === null;
    this.result.value = result; s.durationS.value = result.durationS; s.verdict.value = result.verdict;
    this.applyScore(); this.cancelMode(); this.model.menus.gameMenu.open.value = false; this.screen.value = 'score';
    const game = this.game, config = game?.skirmishConfig;
    if (first && game && !game.replayMode && config) {
      const ai = config.slots.filter(slot => slot.controller === 'ai' && slot.ai !== null).map(slot => `${this.model.locale.peek() === 'en' ? 'AI' : 'KI'} ${t(`ui.skirmish.${slot.ai!.difficulty}`)}`);
      saveLastMatch({ mapName: game.map.name, verdict: result.verdict, durationS: result.durationS, opponent: ai.join(', ') });
    }
  }
  /** Score rows from the host's recorded totals only; never derived from instantaneous frame values. */
  private applyScore(): void {
    const game = this.game, s = this.model.menus.score; if (!game || this.result.peek() === null) return;
    const player = game.client.playerArmy, armies = game.skirmishConfig?.slots.map((_, i) => i) ?? [];
    const view = scoreFromStats(game.matchStats?.peek() ?? null, player, armies.filter(army => army !== player && !this.allied(army)), !game.replayMode);
    batch(() => { s.rows.value = view.rows; s.series.value = view.series; s.events.value = view.events; s.coverage.value = view.coverage; s.enemyLabel.value = view.enemyLabel; });
  }
  /** Visible action errors expire after five seconds and never survive a screen change. */
  fail(message: string): void {
    this.error.value = message;
    if (this.errorTimer !== null) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => { this.errorTimer = null; if (this.error.peek() === message) this.error.value = null; }, ERROR_VISIBLE_MS);
  }
  private invoke(name: 'leaveGame' | 'surrender' | 'openReplay'): void { const port = this.ports?.[name]; if (port) port(); else this.say('unavailable'); }
  /** Player-facing, localized action messages; no internal command or blueprint ids. */
  private say(id: keyof typeof MESSAGES): void { this.fail(MESSAGES[id][this.model.locale.peek() === 'en' ? 1 : 0]); }
  config(): SkirmishConfig { const s = this.model.menus.skirmish; return { mapId: s.selectedMap.peek(), slots: s.slots.peek(), rules: s.rules.peek() }; }
  setSetting<K extends SettingKey>(key: K, value: SettingsValues[K]): void {
    const m = this.model, candidate = { ...m.menus.settings.values.peek(), [key]: value };
    if (validateSettings(candidate).length > 0) { this.say('invalidSetting'); return; }
    const local = ['locale', 'uiScale', 'reducedMotion', 'teamColors', 'edgePan', 'keyScheme', 'tooltips'].includes(key);
    if (!local && !this.ports?.applySetting?.(key, value)) { this.say('settingUnsupported'); return; }
    const preset = key === 'preset' ? parsePresetName(String(value)) : undefined;
    // Without a running Game the preset's own values are stored too, so a later match starts with exactly that preset.
    const applied = key === 'preset' && this.game ? this.game.runtimeSettings : preset !== undefined ? { ...candidate, ...presetSettings(preset) } : candidate;
    m.menus.settings.values.value = applied;
    m.locale.value = candidate.locale; m.keyboardLayout.value = candidate.locale; m.teams.value = candidate.teamColors; m.reducedMotion.value = candidate.reducedMotion;
    uiLocale.value = candidate.locale;
    m.scale.value = candidate.uiScale === 'auto' ? autoScale(typeof window==='undefined'?1080:window.innerHeight) : candidate.uiScale;
    if (this.game) { this.game.client.input.actions = gridActionMap(candidate.keyScheme === 'wasd'); this.game.client.input.edgePanEnabled = candidate.edgePan; }
    try { localStorage.setItem(LOCAL_SETTINGS, JSON.stringify(applied)); } catch { /* Settings still work for this session. */ }
  }
  private typeId(bp: number): string { return hudTypeId(this.game!.bp.ids[bp] ?? ''); }
  private selectedIndices(): number[] {
    const game = this.game, r = game?.client.lastFrame; if (!game || !r) return [];
    const selected = new Set(game.client.selection.selected());
    const result: number[] = []; for (let i = 0; i < r.unitCount; i++) if (selected.has(r.unitHandle(i))) result.push(i); return result;
  }
  private selectByType(id: string, mode: 'only' | 'remove' | 'damaged'): void {
    const game = this.game, r = game?.client.lastFrame; if (!game || !r) return;
    game.client.selectHandles(this.selectedIndices().filter(i => mode === 'remove' ? this.typeId(r.unitVisual(i)) !== id : this.typeId(r.unitVisual(i)) === id && (mode !== 'damaged' || r.unitHp(i) < 128)).map(i => r.unitHandle(i))); this.update(true);
  }
  private filter(kind: string, shift: boolean): void {
    const game = this.game, r = game?.client.lastFrame; if (!game || !r) return;
    const indices = shift ? this.selectedIndices() : Array.from({length:r.unitCount}, (_, i) => i);
    const category = kind === 'engineers' ? 'ENGINEER' : kind === 'factories' ? 'FACTORY' : kind.toUpperCase();
    const viewer = game.client.viewArmy;
    game.client.selectHandles(indices.filter(i => (viewer < 0 || r.unitArmy(i) === viewer) && presentationUnit(this.typeId(r.unitVisual(i)) ?? '')?.categories.includes(category)).map(i => r.unitHandle(i))); this.update(true);
  }
  private selectIdle(category: string, all: boolean): void {
    const game = this.game, r = game?.client.lastFrame; if (!game || !r) return;
    const viewer = game.client.viewArmy;
    const handles: number[] = []; for (let i=0; i<r.unitCount; i++) if ((viewer < 0 || r.unitArmy(i) === viewer) && (r.unitFlags(i) & UnitFlags.Idle) && presentationUnit(this.typeId(r.unitVisual(i)) ?? '')?.categories.includes(category)) handles.push(r.unitHandle(i));
    if (!all && handles.length > 1) { const current = game.client.selection.selected()[0]; const next = (handles.indexOf(current ?? -1) + 1) % handles.length; game.client.selectHandles([handles[next]!]); } else game.client.selectHandles(handles); this.update(true);
  }
  private cardActivate(slot: SlotCode, mods: ClickMods): void {
    const game = this.game; if (!game || game.client.readOnlyCommands) return;
    // Input selection can change before the next HUD rAF. Resolve this action against it now.
    this.update();
    const factories = this.factoryIndices();
    const cell = this.cardCells().find(c => c.slot === slot);
    // Hotkeys of cells the card does not show (missing blueprint, locked or empty) do nothing,
    // exactly like the absent button; the same filter as the rendered build card applies.
    const shown = (id: string | null | undefined) => { const index = id ? game.bp.indexOf(simTypeId(id)) : -1; return index >= 0 && game.bp.buildableByExpr(index) >= 0 ? index : -1; };
    if (factories.length > 0 && cell?.typeId) {
      if (shown(cell.typeId) < 0) return;
      if (mods.button === 2) this.queueRemove(cell.typeId, mods.shift ? 5 : 1);
      else this.queueAdd(cell.typeId, mods.shift ? 5 : 1, mods.ctrl);
      return;
    }
    if (mods.button === 2) { this.cancelMode(); return; }
    const current = this.placement?.slot === slot ? presentationUnit(this.placement.typeId)?.tech ?? null : null;
    const cycle = nextHotbuildTier(slot, current, this.model.card.selectedTypes.peek());
    const typeId = cycle !== null && shown(cycle.typeId) >= 0 ? cycle.typeId : cell?.typeId;
    if (!typeId || !cell || cell.kind !== 'unit' || cell.locked) return;
    const bp = shown(typeId);
    if (bp < 0) return;
    const expr = game.bp.buildableByExpr(bp);
    const builders = this.selectedIndices().some(i => game.bp.buildPowerQ16PerTickCol[game.client.lastFrame!.unitVisual(i)]! > 0 && game.bp.unitMatchesExpr(game.client.lastFrame!.unitVisual(i), expr));
    if (!builders) { this.say('noBuilder'); return; }
    game.client.input.cancelBuildGesture();
    this.placement = { bp, typeId, slot, yaw: 0 }; this.armedOrder = null;
    game.client.input.setBuildGestureHandler(this.buildGesture);
    this.model.card.armedSlot.value = slot; this.model.card.placingTypeId.value = typeId; this.model.card.flashSlot.value = slot; this.flashUntil=performance.now()+140; this.updateGhost();
  }
  /**
   * Card cells the live HUD shows and the grid keys address. Factories get every compiled unit
   * they can actually produce (all tiers on one page): on its roster slot when free, otherwise
   * on the next free grid slot. Builders keep the roster card with its hotbuild tiers.
   */
  cardCells(): readonly CardCellSpec[] {
    const spec = cardSpec(this.model.card).peek(), game = this.game, frame = game?.client.lastFrame;
    if (spec.page !== 'production' || !game || !frame) return spec.cells;
    const factories = this.factoryIndices().map(i => frame.unitVisual(i));
    if (factories.length === 0) return spec.cells;
    const units: { typeId: string; tier: number; preferred: SlotCode | null }[] = [];
    for (let u = 0; u < game.bp.count; u++) if (game.bp.speedPerTick(u) > 0 && factories.some(f => game.bp.canBuild(f, u))) {
      const typeId = this.typeId(u), letter = findUnit(typeId)?.hotbuild?.slot;
      units.push({ typeId, tier: buildRole(game.bp, u).tier, preferred: letter ? `Key${letter}` as SlotCode : null });
    }
    units.sort((a, b) => a.tier - b.tier);
    const used = new Set<SlotCode>(), cells: CardCellSpec[] = [];
    for (const unit of units) {
      const slot = unit.preferred !== null && !used.has(unit.preferred) ? unit.preferred : SLOT_CODES.find(code => !used.has(code));
      if (slot === undefined) break;
      used.add(slot);
      cells.push({ slot, typeId: unit.typeId, tiers: [unit.tier], roleTiers: [unit.tier], shownTier: unit.tier, locked: null, kind: 'unit' });
    }
    return cells.sort((a, b) => SLOT_CODES.indexOf(a.slot) - SLOT_CODES.indexOf(b.slot));
  }
  cancelMode(): void { this.game?.client.input.setBuildGestureHandler(null); this.clearDragGhosts(); this.placement = null; this.armedOrder = null; this.ghost.value = null; this.model.card.armedSlot.value = null; this.model.card.placingTypeId.value = null; this.updateOrders(); }
  private issueGroundOrder(x: number, z: number, queue: boolean, timeStamp = performance.now()): void {
    if (this.screen.peek() !== 'game' || this.model.menus.gameMenu.open.peek()) return;
    if (this.placement || this.armedOrder) { this.cancelMode(); return; }
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    const orders = contextOrders(frame, game.bp, game.client.selection.selected(), game.client.playerArmy, army => this.allied(army), null, true);
    for (const order of orders) {
      if (order.op === Op.Move) game.client.moveTo(x, z, order.units, timeStamp, queue);
      else if (order.op === Op.SetRally) game.client.commands.issue(Op.SetRally, order.units, encodeMove({ x: x as never, y: game.client.heightAtRaw(x, z) as never, z: z as never }), queue, timeStamp);
    }
  }
  private worldAction(action: Action): boolean {
    if (this.screen.peek() !== 'game' || this.model.menus.gameMenu.open.peek()) return !['toggleConsole', 'toggleFullscreen'].includes(action.type);
    if (action.type === 'moveCommand' && (this.placement || this.armedOrder)) { this.cancelMode(); return true; }
    if (action.type === 'clearSelection' && (this.placement || this.armedOrder)) { this.cancelMode(); return true; }
    if (action.type === 'moveCommand') {
      const game = this.game, frame = game?.client.lastFrame;
      if (!game || !frame || game.client.readOnlyCommands) return true;
      const pick = game.client.pickAt(action.x, action.y);
      const target = this.visibleTarget(action.x, action.y);
      const orders = contextOrders(frame, game.bp, game.client.selection.selected(), game.client.playerArmy,
        army => this.allied(army), target, pick !== null);
      for (const order of orders) {
        if (order.op === Op.Move && pick) game.client.moveTo(pick.x, pick.z, order.units, action.timeStamp, action.queue);
        else if (order.target !== undefined) game.client.commands.issue(order.op, order.units, encodeTarget(order.target), action.queue, action.timeStamp);
        else if (pick) game.client.commands.issue(order.op, order.units, encodeMove({x:pick.x as never,y:pick.y as never,z:pick.z as never}), action.queue, action.timeStamp);
      }
      return true;
    }
    if (action.type !== 'clickSelect' || (!this.placement && !this.armedOrder)) return false;
    const game = this.game!; const pick = game.client.pickAt(action.x, action.y); if (!pick) return true;
    if (this.armedOrder) { this.issueArmed(action.x,action.y,pick.x,pick.y,pick.z,action.additive); if (!action.additive) this.cancelMode(); return true; }
    this.updateGhost(pick.x, pick.z);
    const ghost = this.ghost.peek(); if (ghost?.verdict === 0) { game.client.commands.build(game.client.selection.selected(), ghost.bp, ghost.x, ghost.z, ghost.yaw, action.additive, performance.now()); if (!action.additive) this.cancelMode(); } return true;
  }
  private updateGhost(x?: number, z?: number): void {
    if (this.game?.client.input.buildingDrag) { this.updateDragGhosts(); return; }
    const game = this.game, p = this.placement, world = this.placementWorld; if (!game || !p || !world) return;
    const hover = game.client.hover; if (x === undefined && !hover.valid) { this.ghost.value = null; return; }
    this.ghost.value = this.placementGhost(x ?? hover.x, z ?? hover.z);
  }
  private placementGhost(x: number, z: number): BuildGhost {
    const game = this.game!, p = this.placement!, world = this.placementWorld!;
    const w = footprintWidth(game.bp.footprintW(p.bp), game.bp.footprintH(p.bp), p.yaw), h = footprintHeight(game.bp.footprintW(p.bp), game.bp.footprintH(p.bp), p.yaw);
    let sx = Math.round(x / 4096 - w / 2) * 4096 + w * 2048, sz = Math.round(z / 4096 - h / 2) * 4096 + h * 2048;
    const kind = game.bp.spotKindCol[p.bp]!;
    if (kind >= 0) {
      const pointerX = sx, pointerZ = sz; let best = 6 * 4096;
      for (const spot of game.map.spots) {
        const distance = Math.hypot(spot.x - pointerX, spot.z - pointerZ);
        if ((spot.kind === 'mass' ? 0 : 1) === kind && distance < best) { best = distance; sx = spot.x; sz = spot.z; }
      }
    }
    const verdict = canPlace(world, {x:sx,z:sz,w:game.bp.footprintW(p.bp),h:game.bp.footprintH(p.bp),yaw:p.yaw,maxSlopeRaw:game.bp.maxSlope(p.bp),spotKind:kind});
    const corners: [number, number][] = [], roof: [number, number][] = []; const tmp = new Float64Array(4);
    const role = buildRole(game.bp, p.bp).role, lift = (PREVIEW_HEIGHT_WU[role] ?? 2) * 4096;
    let base = -Infinity;
    for (const [dx,dz] of [[-w,-h],[w,-h],[w,h],[-w,h]]) base = Math.max(base, game.client.heightAtRaw(sx + dx! * 2048, sz + dz! * 2048));
    for (const [dx,dz] of [[-w,-h],[w,-h],[w,h],[-w,h]]) { const cx = sx + dx! * 2048, cz = sz + dz! * 2048;
      if (game.client.camera.project(cx, game.client.heightAtRaw(cx,cz), cz, tmp)) corners.push([tmp[0]!,tmp[1]!]);
      if (game.client.camera.project(cx, base + lift, cz, tmp)) roof.push([tmp[0]!,tmp[1]!]); }
    return {bp:p.bp,typeId:p.typeId,x:sx,z:sz,yaw:p.yaw,verdict,corners,roof:roof.length===4?roof:[],role};
  }
  private selectedBuilderHandles(bp: number): number[] {
    const game = this.game, frame = game?.client.lastFrame; if (!game || !frame) return [];
    const expr = game.bp.buildableByExpr(bp); if (expr < 0) return [];
    return this.selectedIndices().filter(index => {
      const builderBp = frame.unitVisual(index);
      return game.bp.buildPowerQ16PerTickCol[builderBp]! > 0 && game.bp.unitMatchesExpr(builderBp, expr);
    }).map(index => frame.unitHandle(index));
  }
  private clearDragGhosts(): void {
    this.dragAnchor = null; this.dragEnd = null; this.dragHandles = []; this.dragSelection = [];
    this.dragPickValid = false; this.dragGhosts.value = [];
  }
  private onBuildGesture(gesture: BuildGesture): void {
    const game = this.game, p = this.placement;
    if (gesture.phase === 'cancel') { this.clearDragGhosts(); return; }
    if (!game || !p || !this.placementWorld || game.client.readOnlyCommands || this.screen.peek() !== 'game' || this.model.menus.gameMenu.open.peek()) { this.clearDragGhosts(); return; }
    if (gesture.phase === 'start') {
      this.ghost.value = null;
      const pick = game.client.pickAt(gesture.x0, gesture.y0);
      if (!pick) { this.clearDragGhosts(); return; }
      this.dragAnchor = this.placementGhost(pick.x, pick.z); this.dragEnd = null; this.dragPickValid = true;
      this.dragSelection = Array.from(game.client.selection.selected());
      this.dragHandles = this.selectedBuilderHandles(p.bp);
    } else if (gesture.dragged || gesture.phase === 'commit') {
      const pick = game.client.pickAt(gesture.x, gesture.y);
      if (!pick) {
        this.dragPickValid = false; this.dragGhosts.value = [];
        if (gesture.phase === 'commit') this.clearDragGhosts();
        return;
      }
      this.dragPickValid = true;
      if (gesture.dragged) this.dragEnd = { x: pick.x, z: pick.z };
      // A short Shift click keeps the existing release-point placement semantics.
      else this.dragAnchor = this.placementGhost(pick.x, pick.z);
    }
    this.updateFootprints(game.client.lastFrame);
    this.updateDragGhosts();
    if (gesture.phase === 'commit') {
      const selected = game.client.selection.selected(), builders = this.selectedBuilderHandles(p.bp);
      if (selected.length === this.dragSelection.length && this.dragSelection.every((handle, i) => handle === selected[i]) &&
          builders.length === this.dragHandles.length && this.dragHandles.every((handle, i) => handle === builders[i])) {
        const now = performance.now();
        for (const site of this.dragGhosts.peek()) if (site.verdict === PlacementVerdict.Valid) game.client.commands.build(this.dragHandles, site.bp, site.x, site.z, site.yaw, true, now);
      }
      this.clearDragGhosts(); this.updateGhost();
    }
  }
  private updateDragGhosts(): void {
    const game = this.game, p = this.placement, anchor = this.dragAnchor;
    if (!game || !p || !anchor || !this.dragPickValid) { this.dragGhosts.value = []; return; }
    const w = footprintWidth(game.bp.footprintW(p.bp), game.bp.footprintH(p.bp), p.yaw) * 4096;
    const h = footprintHeight(game.bp.footprintW(p.bp), game.bp.footprintH(p.bp), p.yaw) * 4096;
    const sites: BuildGhost[] = [], seen = new Set<string>();
    for (const point of buildDragGrid(anchor, this.dragEnd ?? anchor, w, h)) {
      let site = this.placementGhost(point.x, point.z);
      const key = `${site.x}:${site.z}`;
      if (seen.has(key)) continue; seen.add(key);
      if (site.verdict === PlacementVerdict.Valid && sites.some(other => other.verdict === PlacementVerdict.Valid && Math.abs(other.x - site.x) < w && Math.abs(other.z - site.z) < h)) site = { ...site, verdict: PlacementVerdict.Occupied };
      sites.push(site);
    }
    this.dragGhosts.value = sites;
  }
  private updateQueuedGhosts(frame: FrameReader | null): void {
    const game = this.game, world = this.placementWorld;
    if (!game) return;
    game.client.camera.update();
    const ghosts = this.frameBuildIntents.project(frame, bp => bp < game.bp.count ? {
      typeId: this.typeId(bp), width: game.bp.footprintW(bp), height: game.bp.footprintH(bp),
    } : null, {
      heightAt: (x, z) => game.client.heightAtRaw(x, z),
      project: (x, y, z, out) => game.client.camera.project(x, y, z, out),
      ...(world ? { blocker: (site: { readonly bp: number; readonly x: number; readonly z: number; readonly yaw: number }) => canPlace(world, {
        x: site.x, z: site.z, w: game.bp.footprintW(site.bp), h: game.bp.footprintH(site.bp),
        yaw: site.yaw, maxSlopeRaw: game.bp.maxSlope(site.bp), spotKind: game.bp.spotKindCol[site.bp]!,
      }) } : {}),
    });
    if (!equalQueuedGhosts(this.queuedGhosts.peek(), ghosts)) this.queuedGhosts.value = ghosts;
  }
  handleKey(event: KeyboardEvent): boolean {
    const m = this.model; const target = event.target as HTMLElement | null;
    const focus = !!target && (['INPUT','TEXTAREA','SELECT'].includes(target.tagName) || target.isContentEditable);
    if (focus) return false;
    this.update();
    if (event.code === 'Escape') { if (this.placement || this.armedOrder) this.cancelMode(); else if (this.screen.peek() !== 'game') this.commands.backToMenu(); else m.menus.gameMenu.open.value = !m.menus.gameMenu.open.peek(); return true; }
    if (m.menus.gameMenu.open.peek() || this.screen.peek() !== 'game') return false;
    if (event.code === 'Space' && m.alerts.items.peek().length > 0) {
      if (!event.repeat) { if (event.shiftKey) this.commands.cycleAlerts(); else this.commands.jumpToAlert(m.alerts.items.peek()[0]!.id); }
      return true;
    }
    const spec = cardSpec(m.card).peek();
    const action = resolveGridKey({code:event.code,alt:event.altKey,ctrl:event.ctrlKey,shift:event.shiftKey,meta:event.metaKey}, {page:spec.page,cells:this.cardCells(),scheme:m.menus.settings.values.peek().keyScheme,mode:this.armedOrder?'orderArmed':'idle',textFocus:false,modal:false});
    if (action.kind === 'card') { if (!event.repeat) this.commands.cardActivate(action.slot, {button:0,ctrl:event.ctrlKey,alt:event.altKey,shift:event.shiftKey}); return true; }
    if (action.kind === 'order') { if (!event.repeat && m.orders.states.peek()[action.id]?.enabled) this.commands.activateOrder(action.id, {button:0,ctrl:event.ctrlKey,alt:event.altKey,shift:event.shiftKey}); return true; }
    if (action.kind === 'selfDestruct') { if (!event.repeat && m.orders.states.peek().selfDestruct?.enabled) this.commands.activateOrder('selfDestruct', {button:0,ctrl:true,alt:false,shift:false}); return true; }
    return false;
  }
  private factoryIndices(): number[] {
    const game=this.game,frame=game?.client.lastFrame;if(!game||!frame)return [];
    return this.selectedIndices().filter(i=>game.bp.speedPerTick(frame.unitVisual(i))===0&&presentationUnit(this.typeId(frame.unitVisual(i))??'')?.categories.includes('FACTORY'));
  }
  private watchIndex(handle:number):number {
    const r=this.game?.client.lastFrame;if(!r)return -1;
    for(let i=0;i<r.watchCount;i++)if(r.watchHandle(i)===handle)return i;
    return -1;
  }
  private factoryIssue(op:number,payload:Uint8Array):void {
    const game=this.game,r=game?.client.lastFrame;if(!game||!r||game.client.readOnlyCommands)return;
    const handles=this.factoryIndices().map(i=>r.unitHandle(i));
    if(handles.length===0){this.say('noFactory');return;}
    game.client.commands.issue(op,handles,payload,false,performance.now());
  }
  private queueAdd(typeId:string,count:number,front:boolean):void {
    const game=this.game,r=game?.client.lastFrame;if(!game||!r||game.client.readOnlyCommands)return;
    const bp=game.bp.indexOf(simTypeId(typeId)),factories=this.factoryIndices().filter(i=>bp>=0&&game.bp.canBuild(r.unitVisual(i),bp));
    if(factories.length===0){this.say('noEligibleFactory');return;}
    if(!Number.isInteger(count)||count<1||count>32){this.say('invalidCount');return;}
    for(let n=0;n<count;n++)game.client.commands.issue(front?Op.FactoryQueueEdit:Op.FactoryQueue,[r.unitHandle(factories[n%factories.length]!)],
      front?encodeFactoryQueueEdit({action:2,index:0,bp,count:1}):encodeFactoryQueue({bp,count:1}),!front,performance.now());
  }
  private queueRemove(typeId:string,count:number):void {
    const game=this.game,r=game?.client.lastFrame;if(!game||!r||game.client.readOnlyCommands)return;
    let remaining=Math.max(0,Math.min(32,Math.trunc(count)));
    for(const i of this.factoryIndices()){
      const handle=r.unitHandle(i),watch=this.watchIndex(handle);if(watch<0)continue;
      for(let k=r.watchFactoryQueueCount(watch)-1;k>=0&&remaining>0;k--)if(this.typeId(r.watchFactoryQueueBp(watch,k))===typeId){
        game.client.commands.issue(Op.FactoryQueueEdit,[handle],encodeFactoryQueueEdit({action:1,index:k,bp:0,count:1}),false,performance.now());remaining--;
      }
    }
  }
  private activateOrder(id:OrderId):void {
    this.update();
    const game=this.game;if(!game||game.client.readOnlyCommands||!this.model.orders.states.peek()[id]?.enabled)return;
    const selected=game.client.selection.selected();
    if(id==='stop')game.client.stopSelected();
    else if(id==='pause')game.client.commands.issue(Op.TogglePause,selected,encodeTogglePause(this.model.orders.states.peek().pause?.toggle!=='on'),false,performance.now());
    else if(id==='fireState'){
      const cycle=((this.model.orders.states.peek().fireState?.cycle??0)+1)%3;
      game.client.commands.issue(Op.FireState,selected,Uint8Array.of([2,1,0][cycle]!),false,performance.now());
    }else if(id==='selfDestruct'){
      if(this.destructAt>0){this.destructAt=0;this.destructHandles=[];this.model.orders.selfDestructCountdown.value=null;}
      else{this.destructAt=performance.now()+5000;this.destructHandles=Array.from(selected);this.model.orders.selfDestructCountdown.value=5;}
    }else{this.cancelMode();this.armedOrder=id;this.updateOrders();}
  }
  private allied(army:number):boolean {
    const game=this.game;if(!game)return false;if(army===game.client.playerArmy)return true;
    const slots=game.skirmishConfig?.slots,own=slots?.[game.client.playerArmy];
    return own!==undefined&&slots?.[army]?.team===own.team;
  }
  private visibleTarget(x: number, y: number, eligible?: (index: number) => boolean): number | null {
    const client = this.game?.client, frame = client?.lastFrame;
    if (!client || !frame) return null;
    // pickAt has synchronized the viewport. Project each frame index once rather than
    // doing a linear handle lookup for every candidate in a dense army.
    return contextTarget(frame, x, y, (_handle, index) => {
      interpolatedPos(frame, index, client.stream.lastAlpha, this.contextPosition);
      if (!client.camera.project(this.contextPosition[0]!, this.contextPosition[1]!, this.contextPosition[2]!, this.contextPixel)) return null;
      return { x: this.contextPixel[0]!, y: this.contextPixel[1]! };
    }, eligible);
  }
  private issueArmed(px:number,py:number,x:number,y:number,z:number,queue:boolean):void {
    const game=this.game,r=game?.client.lastFrame,id=this.armedOrder;if(!game||!r||!id)return;
    if(id==='move'){game.client.moveTo(x,z,undefined,undefined,queue);return;}
    if(id==='rally'){const factories=completedFactoryHandles(r,game.bp,game.client.selection.selected(),game.client.playerArmy);
      if(factories.length>0)game.client.commands.issue(Op.SetRally,factories,encodeMove({x:x as never,y:y as never,z:z as never}),queue,performance.now());return;}
    const ground:{[key:string]:number}={patrol:Op.Patrol,attackGround:Op.AttackGround};
    if(ground[id]!==undefined){game.client.commands.issue(ground[id]!,game.client.selection.selected(),encodeMove({x:x as never,y:y as never,z:z as never}),queue,performance.now());return;}
    const index=this.visibleTarget(px,py,i=>{
      const flags=r.unitFlags(i);
      const friendly=this.allied(r.unitArmy(i)),wreck=(flags&UnitFlags.Wreck)!==0;
      return (id==='attack'||id==='tapshot')?!friendly&&!wreck:(id==='reclaim'?wreck:friendly&&!wreck);
    });
    const target=index===null?-1:r.unitHandle(index);
    if(target<0){if(id==='attack')game.client.commands.issue(Op.AttackMove,game.client.selection.selected(),encodeMove({x:x as never,y:y as never,z:z as never}),queue,performance.now());else this.say('noTarget');return;}
    const ops:{[key:string]:number}={attack:Op.Attack,assist:Op.Assist,reclaim:Op.Reclaim,repair:Op.Repair,tapshot:Op.Overcharge};
    const op=ops[id];if(op!==undefined)game.client.commands.issue(op,game.client.selection.selected(),encodeTarget(target),queue,performance.now());
  }
  private updateOrders(): void {
    const game=this.game,r=game?.client.lastFrame,indices=this.selectedIndices(),enabled=!!game&&!game.client.readOnlyCommands&&indices.length>0;
    const mobile=!!game&&!!r&&indices.some(i=>game.bp.speedPerTick(r.unitVisual(i))>0);
    const builder=!!game&&!!r&&indices.some(i=>game.bp.buildPowerQ16PerTickCol[r.unitVisual(i)]!>0);
    const armed=!!game&&!!r&&indices.some(i=>game.bp.mountCount(r.unitVisual(i))>0);
    const commander=!!game&&!!r&&indices.some(i=>presentationUnit(this.typeId(r.unitVisual(i))??'')?.categories.includes('COMMAND'));
    const paused=!!r&&indices.every(i=>(r.unitFlags(i)&UnitFlags.Paused)!==0);
    const supported:{[key:string]:boolean}={move:mobile,patrol:mobile,assist:builder,reclaim:builder,repair:builder,attack:armed,stop:true,pause:builder,fireState:armed,attackGround:armed,tapshot:commander,selfDestruct:true};
    let cycle=0;
    if(r&&indices.length){const w=this.watchIndex(r.unitHandle(indices[0]!));if(w>=0)cycle=[2,1,0].indexOf(r.watchFireState(w));if(cycle<0)cycle=0;}
    this.model.orders.states.value=Object.fromEntries(ORDER_IDS.map(id=>[id,{enabled:enabled&&supported[id]===true,
      ...(this.armedOrder===id?{armed:true}:{}),...(id==='pause'?{toggle:paused?'on':'off'}:{}),...(id==='fireState'?{cycle}:{}),...(supported[id]!==true?{reason:'noAbility'}:{})}]));
  }
  update(force = false): void {
    const game = this.game; if (!game) return; const c = game.client, r = c.lastFrame, m = this.model, now = performance.now();
    const viewer = game.replayMode && r ? r.viewer : c.playerArmy;
    if (r) {
      if (viewer !== this.lastViewer || r.tick < this.lastPresentedTick) force = true;
      this.lastViewer = viewer; this.lastPresentedTick = r.tick;
    }
    if (r) this.frameAlerts?.present(r, viewer);
    c.input.setSuspended(this.screen.peek()!=='game'||m.menus.gameMenu.open.peek());
    if(this.destructAt>0){const left=Math.max(0,Math.ceil((this.destructAt-now)/1000));this.model.orders.selfDestructCountdown.value=left;if(left===0){c.commands.issue(Op.SelfDestruct,this.destructHandles,new Uint8Array(0),false,now);this.destructAt=0;this.destructHandles=[];this.model.orders.selfDestructCountdown.value=null;}}
    this.updateFootprints(r); this.updateGhost(); this.updateQueuedGhosts(r); this.updateMinimapFog(now); this.updateCursor();
    if(m.card.flashSlot.peek()&&now>=this.flashUntil)m.card.flashSlot.value=null;
    // The clock follows the accepted frame tick at once (seek, rewind, replay end); whole seconds only.
    const seconds = Math.floor((r?.tick ?? c.tick) / 10);
    batch(() => { if (m.match.timeS.peek() !== seconds) m.match.timeS.value = seconds;
      if(force||now-this.lastStatusAt>=1000){this.lastStatusAt=now;m.match.units.value=c.ownHandles().length;m.card.capReached.value=m.match.units.peek()>=game.unitCap;} m.match.speed.value = c.speed; m.match.pause.value = c.paused ? 'user' : 'none'; m.match.contextLost.value = game.hud.peek().contextLost;
      if (!r) return; const indices = this.selectedIndices(); const key = indices.map(i => r.unitHandle(i)).join(',');
      if (key !== this.lastSelection) { this.cancelMode(); m.card.tab.value = null; this.lastSelection = key; force = true; }
      if (!force && now - this.lastDataAt < 250) return; this.lastDataAt = now;
      const types = [...new Set(indices.map(i => this.typeId(r.unitVisual(i))))]; m.card.selectedTypes.value = types.map(id => id.startsWith('core:cmd_commander_') ? 'core:cmd_commander' : id); m.card.unitCount.value = indices.length;
      m.selection.kind.value = indices.length === 0 ? 'none' : this.factoryIndices().length === indices.length ? 'factory' : indices.length === 1 ? 'single' : 'multi';
      this.updateFactory(r);
      m.selection.single.value = indices.length === 1 ? this.unitDetail(r, indices[0]!) : null;
      const groups = types.map(typeId => ({typeId,count:indices.filter(i => this.typeId(r.unitVisual(i)) === typeId).length}));
      m.selection.multi.value = indices.length > 1 ? {groups,units:indices.slice(0,60).map(i => ({handle:r.unitHandle(i),typeId:this.typeId(r.unitVisual(i))})),total:indices.length} : null;
      m.selection.multiStats.value = indices.length > 1 ? aggregateMultiStats(groups,Math.min(60,indices.length),indices.map(i => { const bp = r.unitVisual(i); return {typeId:this.typeId(bp),hp:r.unitHp(i)/255,vet:(r.unitFlags(i)&UnitFlags.VetMask)>>UnitFlags.VetShift,dps:this.weaponStats(bp).dps,mass:game.bp.massCostCol[bp]!,speed:game.bp.speedPerTick(bp)*10/4096}; })) : null;
      const count = r.unitCount, units = {count,x:new Float32Array(count),z:new Float32Array(count),army:new Uint8Array(count),kind:new Uint8Array(count)};
      for (let i=0;i<count;i++) {units.x[i]=r.unitCur(i,0)/4096;units.z[i]=r.unitCur(i,2)/4096;units.army[i]=r.unitArmy(i)===viewer?0:1;units.kind[i]=(r.unitFlags(i)&UnitFlags.Building)?1:0;}
      m.minimap.units.value = units;
      const camera: [number,number][] = []; for (const [x,y] of [[0,0],[c.camera.viewportWidth,0],[c.camera.viewportWidth,c.camera.viewportHeight],[0,c.camera.viewportHeight]]) { const p=c.pickAt(x!,y!); if (p) camera.push([p.x/4096,p.z/4096]); } m.minimap.camera.value = camera;
      const ownIndices=Array.from({length:r.unitCount},(_,i)=>i).filter(i=>r.unitArmy(i)===viewer);
      m.strip.idleEngineers.value=ownIndices.filter(i=>(r.unitFlags(i)&UnitFlags.Idle)&&presentationUnit(this.typeId(r.unitVisual(i))??'')?.categories.includes('ENGINEER')).length;
      m.strip.idleFactories.value=ownIndices.filter(i=>(r.unitFlags(i)&UnitFlags.Idle)&&presentationUnit(this.typeId(r.unitVisual(i))??'')?.categories.includes('FACTORY')).length;
      // snapshot() is indexed by digit; strip slot i is digit (i + 1) % 10, as in save/recallGroup.
      const digits = c.controlGroups.snapshot(); m.strip.groups.value = digits.map((_, i) => ({count:digits[(i + 1) % 10]?.length ?? 0,iconTypeId: null}));
      this.updateOrders();
    });
    if (force || now - this.lastEcoAt >= 100) { this.lastEcoAt = now; this.updateEconomy(r); this.updateFactoryProgress(r); this.updateCommanderUpgrade(r); this.updateExtractorUpgrade(r); this.updateFactoryUpgrade(r); if (r) this.updatePausedSelection(r); }
  }
  private jumpToAlert(id: number): void {
    const item = this.frameAlerts?.find(id);
    if (!item) return;
    if (item.type === 'massStall' || item.type === 'energyStall') this.model.eco.detailsOpen.value = true;
    else if (item.location) this.game?.client.jumpTo(item.location.x * 4096, item.location.z * 4096);
  }
  private updateMinimapFog(now: number): void {
    const snapshot = this.game?.visibility?.snapshot;
    if (!snapshot) {
      if (this.model.minimap.fog.peek() !== null) this.model.minimap.fog.value = null;
      this.lastMinimapFogEpoch = -1;
      return;
    }
    if (snapshot.epoch === this.lastMinimapFogEpoch && now - this.lastMinimapFogAt < 500) return;
    this.lastMinimapFogAt = now; this.lastMinimapFogEpoch = snapshot.epoch;
    if (this.minimapFogCells.length !== snapshot.cells.length) this.minimapFogCells = new Uint8Array(snapshot.cells.length);
    this.minimapFogCells.set(snapshot.cells);
    this.model.minimap.fog.value = { res: snapshot.dim, cells: this.minimapFogCells };
  }
  private updateFactory(r:FrameReader):void {
    const game=this.game!,m=this.model,factories=this.factoryIndices();
    if(factories.length===0){m.factory.detail.value=null;m.factory.queue.value=null;return;}
    const i=factories[0]!,bp=r.unitVisual(i),handle=r.unitHandle(i),w=this.watchIndex(handle);
    if(w<0){m.factory.detail.value=null;m.factory.queue.value=null;return;}
    // While a factory upgrades itself the watch reports the upgrade, not a product.
    const upgrading=(wi:number)=>r.watchTargetCount(wi)>0&&r.watchTargetType(wi,0)===WatchOrderType.Upgrade;
    const current=upgrading(w)?-1:r.watchFactoryBp(w),progress=upgrading(w)?0:r.watchFactoryProgress(w)/65536;
    const assist = frameFactoryAssistance(r, handle, r.watchBuildTarget(w), visual => this.flowSubject(visual));
    m.factory.detail.value={handle,typeId:this.typeId(bp),hp:Math.round(r.unitHp(i)/255*game.bp.maxHp(bp)),hpMax:game.bp.maxHp(bp),bpOwn:game.bp.buildPowerQ16PerTickCol[bp]!*10/65536,bpAssist:assist.bpAssist,helpers:assist.helpers,adjacencyPct:0,rally:r.watchRallyX(w)>=0?'point':'none',factoryCount:factories.length};
    const queue:string[]=[];for(const u of factories){const wi=this.watchIndex(r.unitHandle(u));if(wi<0)continue;for(let k=r.watchFactoryBp(wi)>=0&&!upgrading(wi)?1:0;k<r.watchFactoryQueueCount(wi);k++){const index=r.watchFactoryQueueBp(wi,k);if(index>=0&&game.bp.ids[index]!==undefined)queue.push(this.typeId(index));}}
    m.factory.queue.value={current:current<0?null:{typeId:this.typeId(current)},blocks:mergeQueue(queue),repeat:r.watchFactoryRepeat(w),paused:(r.unitFlags(i)&UnitFlags.Paused)!==0};
    m.factory.progress.value=progress;
    m.card.queueCounts.value=Object.fromEntries(mergeQueue(queue).map(block=>[block.typeId,block.count]));
    m.card.progress.value=current>=0?{[this.typeId(current)]:progress}:{};
    const buildTime=current<0?0:game.bp.buildTimeCol[current]!;
    m.factory.remainingS.value=current<0?0:assist.available&&assist.bpEffective>0?(1-progress)*buildTime/assist.bpEffective:null;
  }
  private weaponStats(bp: number): {dps:number;range:number} {
    const table=this.game!.bp;let dps=0,range=0;
    for(let m=table.firstMount(bp);m<table.firstMount(bp)+table.mountCount(bp);m++) {const weapon=table.mountWeaponCol[m]!;
      dps+=table.weaponDamageCol[weapon]!*table.weaponSalvoCol[weapon]!*10/Math.max(1,table.weaponReloadTicksCol[weapon]!);
      range=Math.max(range,table.weaponRangeCol[weapon]!/4096);}
    return {dps,range};
  }
  startCommanderUpgrade(moduleId?: CommanderEnhancementId): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    this.updateCommanderUpgrade(frame);
    const state = this.commanderUpgrade.peek();
    const module = moduleId ? state?.enhancements.find(entry => entry.id === moduleId) : state?.enhancements.find(entry => entry.enabled);
    if (!state?.enabled || !module?.enabled || !module.targetTypeId) return;
    const bp = game.bp.indexOf(module.targetTypeId), payload = new Uint8Array(2);
    if (bp < 0) return;
    new DataView(payload.buffer).setUint16(0, bp, true);
    this.cancelMode();
    game.client.commands.issue(Op.Upgrade, [state.handle], payload, false, performance.now());
  }
  pauseCommanderUpgrade(): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    this.updateCommanderUpgrade(frame);
    const state = this.commanderUpgrade.peek();
    if (state?.active && state.controllable) game.client.commands.issue(Op.TogglePause, [state.handle], encodeTogglePause(!state.paused), false, performance.now());
  }
  cancelCommanderUpgrade(): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    this.updateCommanderUpgrade(frame);
    const state = this.commanderUpgrade.peek();
    if (state?.queued && state.controllable) this.cancelUpgrade(state.handle, state.paused);
  }
  /**
   * Explicit upgrade cancel only. Upgrade pause and manual pause share the Sim's ecoPaused
   * flag, so a paused upgrader is resumed after the Stop (lower seq, applied first). Generic
   * Stop keeps its historical semantics and leaves any manual pause untouched.
   */
  private cancelUpgrade(handle: number, paused: boolean): void {
    const game = this.game!, now = performance.now();
    game.client.commands.issue(Op.Stop, [handle], new Uint8Array(0), false, now);
    if (paused) game.client.commands.issue(Op.TogglePause, [handle], encodeTogglePause(false), false, now);
  }
  /** Resumes only own, currently paused, selected units. */
  resumeSelection(): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    const handles = this.ownPausedHandles(frame);
    if (handles.length > 0) game.client.commands.issue(Op.TogglePause, handles, encodeTogglePause(false), false, performance.now());
  }
  private ownPausedHandles(frame: FrameReader): number[] {
    const game = this.game!;
    return this.selectedIndices().filter(i => frame.unitArmy(i) === game.client.playerArmy && (frame.unitFlags(i) & UnitFlags.Paused) !== 0).map(i => frame.unitHandle(i));
  }
  private updatePausedSelection(frame: FrameReader): void {
    const game = this.game!, paused = game.replayMode ? 0 : this.ownPausedHandles(frame).length;
    const next = paused === 0 ? null : { count: paused, total: this.selectedIndices().length, controllable: !game.client.readOnlyCommands };
    const current = this.pausedSelection.peek();
    if (current?.count !== next?.count || current?.total !== next?.total || current?.controllable !== next?.controllable) this.pausedSelection.value = next;
  }
  private updateCommanderUpgrade(frame: FrameReader | null): void {
    const game = this.game, indices = this.selectedIndices();
    if (!game || !frame || indices.length !== 1) { this.commanderUpgrade.value = null; return; }
    const i = indices[0]!, bp = frame.unitVisual(i), id = game.bp.ids[bp]!;
    const installedMask = commanderEnhancementMask(id);
    if (installedMask < 0) {
      this.commanderUpgrade.value = null; return;
    }
    const handle = frame.unitHandle(i), watch = this.watchIndex(handle), successor = game.bp.upgradesTo(bp);
    let queued = false;
    if (watch >= 0) for (let k = 0; k < frame.watchTargetCount(watch); k++) queued ||= frame.watchTargetType(watch, k) === WatchOrderType.Upgrade;
    const active = watch >= 0 && frame.watchTargetCount(watch) > 0 && frame.watchTargetType(watch, 0) === WatchOrderType.Upgrade && frame.watchFactoryBp(watch) >= 0;
    const target = active ? frame.watchFactoryBp(watch) : successor, progress = active ? frame.watchFactoryProgress(watch) / 65536 : 0;
    const activeEnhancementId = active ? commanderEnhancementAdded(id, game.bp.ids[target]!) : null;
    const costModule = target >= 0 ? commanderEnhancementAdded(id, game.bp.ids[target]!) : null;
    const costBp = costModule ? game.bp.indexOf(commanderEnhancementCostId(costModule)) : target;
    const paused = (frame.unitFlags(i) & UnitFlags.Paused) !== 0, stalled = active && !paused && (frame.unitFlags(i) & UnitFlags.Stalled) !== 0;
    let effectivePower: number | null = null;
    if (active && frame.flowTick === frame.tick) for (let f = 0; f < frame.flowCount; f++) if (frame.flowHandle(f) === handle) {
      for (let e = 0; e < frame.ecoCount; e++) if (frame.ecoArmy(e) === frame.flowArmy(f))
        effectivePower = Math.floor(frame.flowEffectivePower(f) * frame.ecoRatio(e, frame.flowPriority(f)) / 65536) * 10 / 65536;
    }
    const controllable = !game.client.readOnlyCommands && frame.unitArmy(i) === game.client.playerArmy;
    const weapons = this.weaponStats(bp);
    const enhancements = COMMANDER_ENHANCEMENTS.map(module => {
      const targetTypeId = commanderEnhancementTarget(id, module.id), next = targetTypeId ? game.bp.indexOf(targetTypeId) : -1;
      const moduleCost = game.bp.indexOf(commanderEnhancementCostId(module.id));
      const stats = next >= 0 ? this.weaponStats(next) : weapons;
      return {
        id: module.id, slot: module.slot, installed: (installedMask & module.bit) !== 0,
        enabled: next >= 0 && moduleCost >= 0 && !queued && controllable,
        targetTypeId, mass: moduleCost >= 0 ? game.bp.massCostCol[moduleCost]! : 0,
        energy: moduleCost >= 0 ? game.bp.energyCostCol[moduleCost]! : 0,
        buildTime: moduleCost >= 0 ? game.bp.buildTimeCol[moduleCost]! : 0,
        targetBuildPower: game.bp.buildPowerQ16PerTickCol[next >= 0 ? next : bp]! * 10 / 65536,
        targetHpMax: game.bp.maxHpCol[next >= 0 ? next : bp]!,
        targetWeaponRange: stats.range, targetWeaponDps: stats.dps,
      };
    });
    this.commanderUpgrade.value = {
      handle, currentTypeId: id, targetTypeId: target >= 0 ? game.bp.ids[target]! : null,
      stage: (installedMask & 4) !== 0 ? 'armored' : (installedMask & 1) !== 0 ? 'engineering' : 'base',
      active, queued, progress, paused, stalled, controllable,
      enabled: enhancements.some(module => module.enabled), enhancements, activeEnhancementId,
      weaponRange: weapons.range, weaponDps: weapons.dps,
      mass: costBp >= 0 ? game.bp.massCostCol[costBp]! : 0, energy: costBp >= 0 ? game.bp.energyCostCol[costBp]! : 0,
      buildPower: game.bp.buildPowerQ16PerTickCol[bp]! * 10 / 65536, hpMax: game.bp.maxHpCol[bp]!,
      targetBuildPower: target >= 0 ? game.bp.buildPowerQ16PerTickCol[target]! * 10 / 65536 : game.bp.buildPowerQ16PerTickCol[bp]! * 10 / 65536,
      targetHpMax: target >= 0 ? game.bp.maxHpCol[target]! : game.bp.maxHpCol[bp]!,
      remainingS: active && costBp >= 0 && !paused && effectivePower !== null && effectivePower > 0 ? (1 - progress) * game.bp.buildTimeCol[costBp]! / effectivePower : null,
    };
  }

  startExtractorUpgrade(): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    this.updateExtractorUpgrade(frame);
    const state = this.extractorUpgrade.peek();
    if (!state?.enabled || !state.targetTypeId) return;
    const bp = game.bp.indexOf(state.targetTypeId), payload = new Uint8Array(2);
    if (bp < 0) return;
    new DataView(payload.buffer).setUint16(0, bp, true);
    this.cancelMode();
    game.client.commands.issue(Op.Upgrade, [state.handle], payload, false, performance.now());
  }
  pauseExtractorUpgrade(): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    this.updateExtractorUpgrade(frame);
    const state = this.extractorUpgrade.peek();
    if (state?.active && state.controllable) game.client.commands.issue(Op.TogglePause, [state.handle], encodeTogglePause(!state.paused), false, performance.now());
  }
  cancelExtractorUpgrade(): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    this.updateExtractorUpgrade(frame);
    const state = this.extractorUpgrade.peek();
    if (state?.queued && state.controllable) this.cancelUpgrade(state.handle, state.paused);
  }
  private updateExtractorUpgrade(frame: FrameReader | null): void {
    const game = this.game, indices = this.selectedIndices();
    if (!game || !frame || indices.length !== 1) { this.extractorUpgrade.value = null; return; }
    const i = indices[0]!, bp = frame.unitVisual(i), id = game.bp.ids[bp]!;
    if (id !== 'core:str_t1_mex' && id !== 'core:str_t2_mex' && id !== 'core:str_t3_mex') {
      this.extractorUpgrade.value = null; return;
    }
    const handle = frame.unitHandle(i), watch = this.watchIndex(handle), successor = game.bp.upgradesTo(bp);
    let queued = false;
    if (watch >= 0) for (let k = 0; k < frame.watchTargetCount(watch); k++) queued ||= frame.watchTargetType(watch, k) === WatchOrderType.Upgrade;
    const active = watch >= 0 && frame.watchTargetCount(watch) > 0 && frame.watchTargetType(watch, 0) === WatchOrderType.Upgrade && frame.watchFactoryBp(watch) >= 0;
    const target = active ? frame.watchFactoryBp(watch) : successor, progress = active ? frame.watchFactoryProgress(watch) / 65536 : 0;
    const paused = (frame.unitFlags(i) & UnitFlags.Paused) !== 0, stalled = active && !paused && (frame.unitFlags(i) & UnitFlags.Stalled) !== 0;
    let effectivePower: number | null = null;
    if (active && frame.flowTick === frame.tick) for (let f = 0; f < frame.flowCount; f++) if (frame.flowHandle(f) === handle) {
      for (let e = 0; e < frame.ecoCount; e++) if (frame.ecoArmy(e) === frame.flowArmy(f))
        effectivePower = Math.floor(frame.flowEffectivePower(f) * frame.ecoRatio(e, frame.flowPriority(f)) / 65536) * 10 / 65536;
    }
    this.extractorUpgrade.value = {
      handle, currentTypeId: id, targetTypeId: target >= 0 ? game.bp.ids[target]! : null,
      tier: id === 'core:str_t1_mex' ? 1 : id === 'core:str_t2_mex' ? 2 : 3,
      targetTier: target < 0 ? null : game.bp.ids[target] === 'core:str_t2_mex' ? 2 : 3,
      massIncome: game.bp.massIncomeMilliPerTickCol[bp]! / 100,
      targetMassIncome: game.bp.massIncomeMilliPerTickCol[target >= 0 ? target : bp]! / 100,
      energyUpkeep: game.bp.energyUpkeepMilliPerTickCol[bp]! / 100,
      targetEnergyUpkeep: game.bp.energyUpkeepMilliPerTickCol[target >= 0 ? target : bp]! / 100,
      active, queued, progress, paused, stalled,
      controllable: !game.client.readOnlyCommands && frame.unitArmy(i) === game.client.playerArmy,
      enabled: target >= 0 && frame.unitBuild(i) === 255 && !queued && !game.client.readOnlyCommands && frame.unitArmy(i) === game.client.playerArmy,
      mass: target >= 0 ? game.bp.massCostCol[target]! : 0, energy: target >= 0 ? game.bp.energyCostCol[target]! : 0,
      buildPower: game.bp.buildPowerQ16PerTickCol[bp]! * 10 / 65536, hpMax: game.bp.maxHpCol[bp]!,
      targetBuildPower: target >= 0 ? game.bp.buildPowerQ16PerTickCol[target]! * 10 / 65536 : game.bp.buildPowerQ16PerTickCol[bp]! * 10 / 65536,
      targetHpMax: target >= 0 ? game.bp.maxHpCol[target]! : game.bp.maxHpCol[bp]!,
      remainingS: active && target >= 0 && !paused && effectivePower !== null && effectivePower > 0 ? (1 - progress) * game.bp.buildTimeCol[target]! / effectivePower : null,
    };
  }

  startFactoryUpgrade(): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    this.updateFactoryUpgrade(frame);
    const state = this.factoryUpgrade.peek();
    if (!state?.enabled || !state.targetTypeId) return;
    const bp = game.bp.indexOf(simTypeId(state.targetTypeId)), payload = new Uint8Array(2);
    if (bp < 0) return;
    new DataView(payload.buffer).setUint16(0, bp, true);
    this.cancelMode();
    game.client.commands.issue(Op.Upgrade, [state.handle], payload, false, performance.now());
  }
  pauseFactoryUpgrade(): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    this.updateFactoryUpgrade(frame);
    const state = this.factoryUpgrade.peek();
    if (state?.active && state.controllable) game.client.commands.issue(Op.TogglePause, [state.handle], encodeTogglePause(!state.paused), false, performance.now());
  }
  /** Stop cancels only a factory's own upgrade (ms6.3); its production queue is kept. */
  cancelFactoryUpgrade(): void {
    const game = this.game, frame = game?.client.lastFrame;
    if (!game || !frame || game.client.readOnlyCommands) return;
    this.updateFactoryUpgrade(frame);
    const state = this.factoryUpgrade.peek();
    if (state?.queued && state.controllable) this.cancelUpgrade(state.handle, state.paused);
  }
  private updateFactoryUpgrade(frame: FrameReader | null): void {
    const game = this.game, indices = this.selectedIndices();
    if (!game || !frame || indices.length !== 1) { this.factoryUpgrade.value = null; return; }
    const i = indices[0]!, bp = frame.unitVisual(i), role = buildRole(game.bp, bp);
    if (role.role !== 'factory' || game.bp.speedPerTick(bp) !== 0 || frame.unitBuild(i) !== 255) { this.factoryUpgrade.value = null; return; }
    const handle = frame.unitHandle(i), watch = this.watchIndex(handle), successor = game.bp.upgradesTo(bp);
    let queued = false;
    if (watch >= 0) for (let k = 0; k < frame.watchTargetCount(watch); k++) queued ||= frame.watchTargetType(watch, k) === WatchOrderType.Upgrade;
    const active = watch >= 0 && frame.watchTargetCount(watch) > 0 && frame.watchTargetType(watch, 0) === WatchOrderType.Upgrade && frame.watchFactoryBp(watch) >= 0;
    const target = active ? frame.watchFactoryBp(watch) : successor, progress = active ? frame.watchFactoryProgress(watch) / 65536 : 0;
    const paused = (frame.unitFlags(i) & UnitFlags.Paused) !== 0, stalled = active && !paused && (frame.unitFlags(i) & UnitFlags.Stalled) !== 0;
    let effectivePower: number | null = null;
    if (active && frame.flowTick === frame.tick) for (let f = 0; f < frame.flowCount; f++) if (frame.flowHandle(f) === handle) {
      for (let e = 0; e < frame.ecoCount; e++) if (frame.ecoArmy(e) === frame.flowArmy(f))
        effectivePower = Math.floor(frame.flowEffectivePower(f) * frame.ecoRatio(e, frame.flowPriority(f)) / 65536) * 10 / 65536;
    }
    // Mobile units the successor can produce and the current tier cannot: what the upgrade unlocks.
    const unlocks: string[] = [];
    if (target >= 0) for (let u = 0; u < game.bp.count; u++) if (game.bp.speedPerTick(u) > 0 && game.bp.canBuild(target, u) && !game.bp.canBuild(bp, u)) unlocks.push(this.typeId(u));
    const own = frame.unitArmy(i) === game.client.playerArmy && !game.client.readOnlyCommands;
    const next = {
      handle, currentTypeId: this.typeId(bp), targetTypeId: target >= 0 ? this.typeId(target) : null,
      tier: role.tier, targetTier: target >= 0 ? buildRole(game.bp, target).tier : null, unlocks,
      active, queued, progress, paused, stalled, controllable: own, enabled: target >= 0 && !queued && own,
      mass: target >= 0 ? game.bp.massCostCol[target]! : 0, energy: target >= 0 ? game.bp.energyCostCol[target]! : 0,
      buildPower: game.bp.buildPowerQ16PerTickCol[bp]! * 10 / 65536, hpMax: game.bp.maxHpCol[bp]!,
      targetBuildPower: game.bp.buildPowerQ16PerTickCol[target >= 0 ? target : bp]! * 10 / 65536,
      targetHpMax: game.bp.maxHpCol[target >= 0 ? target : bp]!,
      remainingS: active && target >= 0 && !paused && effectivePower !== null && effectivePower > 0 ? (1 - progress) * game.bp.buildTimeCol[target]! / effectivePower : null,
    };
    this.factoryUpgrade.value = next;
  }

  private updateFactoryProgress(frame: FrameReader | null): void {
    const game = this.game, detail = this.model.factory.detail.peek();
    if (!game || !frame || !detail) return;
    const watch = this.watchIndex(detail.handle);
    if (watch < 0) { this.model.factory.remainingS.value = null; return; }
    const upgrading = frame.watchTargetCount(watch) > 0 && frame.watchTargetType(watch, 0) === WatchOrderType.Upgrade;
    const current = upgrading ? -1 : frame.watchFactoryBp(watch), progress = upgrading ? 0 : frame.watchFactoryProgress(watch) / 65536;
    const flow = frameFactoryAssistance(frame, detail.handle, frame.watchBuildTarget(watch), visual => this.flowSubject(visual));
    this.model.factory.progress.value = progress;
    this.model.factory.remainingS.value = current < 0 ? 0 : flow.available && flow.bpEffective > 0
      ? (1 - progress) * game.bp.buildTimeCol[current]! / flow.bpEffective : null;
  }
  private unitDetail(r: FrameReader, i: number) {
    const game=this.game!, bp=r.unitVisual(i), orders:OrderEntry[]=[];
    for(let w=0;w<r.watchCount;w++) if(r.watchHandle(w)===r.unitHandle(i)) for(let k=0;k<r.watchTargetCount(w);k++) orders.push({kind:({[WatchOrderType.Build]:'build',[WatchOrderType.Attack]:'attack',[WatchOrderType.AttackMove]:'attackMove',[WatchOrderType.Assist]:'assist',[WatchOrderType.Patrol]:'patrol',[WatchOrderType.Repair]:'repair',[WatchOrderType.Guard]:'guard',[WatchOrderType.Reclaim]:'reclaim',[WatchOrderType.Upgrade]:'upgrade'} as Record<number,OrderEntry['kind']>)[r.watchTargetType(w,k)]??'move',x:r.watchTargetX(w,k)/4096,z:r.watchTargetZ(w,k)/4096});
    return {handle:r.unitHandle(i),typeId:this.typeId(bp),hp:Math.round(r.unitHp(i)/255*game.bp.maxHp(bp)),hpMax:game.bp.maxHp(bp),vet:{level:(r.unitFlags(i)&UnitFlags.VetMask)>>UnitFlags.VetShift,progress:0},tapshot:null,stats:{...this.weaponStats(bp),speed:game.bp.speedPerTick(bp)*10/4096,vision:game.bp.vision(bp)/4096,buildPower:game.bp.buildPowerQ16PerTickCol[bp]!*10/65536,regen:0},orders};
  }
  private updateEconomy(frame: FrameReader | null): void {
    const game=this.game; if(!frame||!game) return;
    const viewer = game.replayMode ? frame.viewer : game.client.playerArmy;
    if (viewer < 0) { this.clearEconomy(); return; }
    for(let i=0;i<frame.ecoCount;i++) if(frame.ecoArmy(i)===viewer) {
      const m=this.model;
      batch(()=> {for(const [target,stored,capacity,income,demand,spent] of [
        [m.eco.mass,EcoField.massStored,EcoField.massCapacity,EcoField.massIncome,EcoField.massDemand,EcoField.massSpent],
        [m.eco.energy,EcoField.energyStored,EcoField.energyCapacity,EcoField.energyIncome,EcoField.energyDemand,EcoField.energySpent],
      ] as const) {target.stored.value=frame.ecoValue(i,stored)/1000;target.capacity.value=frame.ecoValue(i,capacity)/1000;
        target.income.value=frame.ecoValue(i,income)/100;target.demand.value=frame.ecoValue(i,demand)/100;target.served.value=frame.ecoValue(i,spent)/100;
        target.flow.value=target.demand.peek()>0?Math.min(1,target.served.peek()/target.demand.peek()):1;}
        m.eco.consumers.value = frameFlowConsumers(frame, visual => this.flowSubject(visual));
        m.eco.interactive.value = !game.client.readOnlyCommands && frame.flowTick === frame.tick;
        this.ecoAvailable.value = true;
      }); return;
    }
    this.clearEconomy();
  }
  private clearEconomy(): void {
    batch(() => {
      for (const target of [this.model.eco.mass, this.model.eco.energy]) {
        target.stored.value=0; target.capacity.value=0; target.income.value=0; target.demand.value=0; target.served.value=0; target.flow.value=1;
      }
      this.model.eco.consumers.value=[]; this.model.eco.interactive.value=false;
      this.ecoAvailable.value = false;
    });
  }
  private flowSubject(bp: number) {
    const typeId = this.typeId(bp);
    return { typeId, factory: presentationUnit(typeId)?.categories.includes('FACTORY') === true };
  }
  private updateFootprints(frame: FrameReader | null): void {
    const world=this.placementWorld; if(!world||!frame||frame.seq===this.lastFootprintSeq||!(frame.flags&FrameFlags.FootprintSnapshot))return;
    this.lastFootprintSeq=frame.seq;
    const foot=world.footprints;foot.fill(0);const size=world.terrain.sizeWu;
    for(let i=0;i<frame.footprintCount;i++) {const x=frame.footprintX(i),z=frame.footprintZ(i),w=frame.footprintW(i),h=frame.footprintH(i),count=frame.footprintDelta(i);
      for(let cz=Math.max(0,z);cz<Math.min(size,z+h);cz++) for(let cx=Math.max(0,x);cx<Math.min(size,x+w);cx++)foot[cz*size+cx]=count;}
    this.model.minimap.spots.value=this.game!.map.spots.map(spot=>({x:spot.x/4096,z:spot.z/4096,kind:spot.kind,taken:(foot[(spot.z>>12)*size+(spot.x>>12)]??0)>0}));
  }
  setMaps(maps: readonly SkirmishMap[], config?: SkirmishConfig): void {
    const s=this.model.menus.skirmish; s.maps.value=maps;
    if(config) {s.selectedMap.value=config.mapId;s.slots.value=config.slots;s.rules.value=config.rules;} else s.selectedMap.value=maps[0]?.id??'';
    s.validation.value={state:'ok',simId:this.game?.ready?.simId.toString(16)??'',message:null};
  }
  private updateCursor(): void {
    const game = this.game; if (!game) return;
    const client = game.client, input = client.input, frame = client.lastFrame;
    let contextual: GameCursor = 'arrow';
    if (this.screen.peek() === 'game' && !this.model.menus.gameMenu.open.peek() && input.pointerInside) {
      if (!client.readOnlyCommands && this.placement) {
        const valid = input.buildingDrag ? this.dragGhosts.peek().some(site => site.verdict === PlacementVerdict.Valid) : this.ghost.peek()?.verdict === PlacementVerdict.Valid;
        contextual = valid ? 'build' : 'blocked';
      }
      else if (!client.readOnlyCommands && this.armedOrder) contextual = client.hover.valid ? ORDER_CURSORS[this.armedOrder] ?? 'arrow' : 'blocked';
      else {
        if (!client.readOnlyCommands && frame) for (let k = 0; k < client.selection.count; k++) {
          if (game.bp.speedPerTick(frame.unitVisual(client.selection.indices[k]!)) > 0) { contextual = 'move'; break; }
        }
        if (this.cursorOwnUnit() >= 0) contextual = 'select';
      }
    }
    this.worldCursor.present(gameCursor(input.cursor.state, input.cursor.edgeX, input.cursor.edgeY, contextual), input.confined);
  }
  /** Cached accepted-frame hit cue; the cursor never scans hidden World units. */
  private cursorOwnUnit(): number {
    const game = this.game!, client = game.client, frame = client.lastFrame;
    if (!frame) return -1;
    const q = this.cursorQuery, input = client.input, camera = client.camera, viewer = client.viewArmy;
    if (q.x === input.pointerX && q.y === input.pointerY && q.camera === camera.version && q.seq === frame.seq && q.viewer === viewer) return q.handle;
    q.x = input.pointerX; q.y = input.pointerY; q.camera = camera.version; q.seq = frame.seq; q.viewer = viewer; q.handle = -1;
    let closest = 14 * 14;
    for (let i = 0; i < frame.unitCount; i++) {
      if ((viewer >= 0 && frame.unitArmy(i) !== viewer) || (frame.unitFlags(i) & (UnitFlags.Ghost | UnitFlags.Blip | UnitFlags.Wreck))) continue;
      if (!camera.project(frame.unitCur(i,0), frame.unitCur(i,1), frame.unitCur(i,2), this.cursorPoint)) continue;
      const distance = (this.cursorPoint[0]! - q.x) ** 2 + (this.cursorPoint[1]! - q.y) ** 2;
      if (distance < closest) { closest = distance; q.handle = frame.unitHandle(i); }
    }
    return q.handle;
  }
  dispose(): void { for (const dispose of this.disposers.splice(0)) dispose(); if (this.errorTimer !== null) clearTimeout(this.errorTimer); this.game?.client.input.setBuildGestureHandler(null); this.clearDragGhosts(); this.worldCursor.dispose(); this.game?.client.setActionInterceptor(null); }
}
