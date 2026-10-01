import {
  createAudioEngine, type AudioEngineOptions, type AudioEventSource, type AudioSettings,
  type FafAudioEngine, type ListenerState, type LoadReport,
} from '@faf/audio';
import { CommandBatchView, EventType, Op, type FrameReader } from '@faf/protocol';
import { audioHudSettings, audioSettingsPatch, localAudioPreferencesStore, readAudioPreferences, type AudioPreferencesStore, type GameAudioSettings } from './settings.ts';
import { EconomyAudio } from './economy.ts';
import { COMMANDER_DEATH_AUDIO_TYPE, STORAGE_FULL_ALERT_INDEX } from './protocol.ts';

export interface GameAudioOptions {
  readonly gestureTarget: EventTarget;
  readonly playerArmy: number;
  /** The protocol's actual table, deliberately required instead of demo event IDs. */
  readonly eventTypes: Readonly<Record<number, string>>;
  readonly visualName: (visual: number) => string | undefined;
  readonly replayMode?: boolean;
  /** Actual match-end opcode; defaults to the protocol EventType.MatchEnd. */
  readonly matchEndType?: number;
  readonly baseUrl?: string;
  /** Optional role-specific ack for the first unit of an issued command. */
  readonly acknowledgement?: (handle: number) => string | undefined;
  readonly preferencesStore?: AudioPreferencesStore;
  readonly engineOptions?: Omit<AudioEngineOptions, 'baseUrl' | 'eventTypes' | 'visualName' | 'unlockTarget'>;
}

/** Sound bank lives next to the current build page, including /b/<hash>/ entry URLs. */
export function gameAudioBaseUrl(baseUri?: string): string {
  const uri = baseUri ?? (typeof document === 'undefined' ? undefined : document.baseURI);
  return uri === undefined ? '/audio/' : new URL('audio/', uri).href;
}

/** Zero-copy accessors over the real frame; indices only exclude repeated/disabled events. */
class FrameEvents implements AudioEventSource {
  private frame: FrameReader | null = null;
  private indices = new Uint32Array(64);
  eventCount = 0;
  private kinds: Readonly<Record<number, string>> = {};
  bind(frame: FrameReader, afterTick: number, kinds: Readonly<Record<number, string>>, audibleStall: boolean, matchEndType: number, playerArmy: number): number {
    this.frame = frame;
    this.kinds = kinds;
    this.eventCount = 0;
    if (this.indices.length < frame.eventCount) this.indices = new Uint32Array(frame.eventCount);
    let newest = afterTick;
    for (let i = 0; i < frame.eventCount; i++) {
      const tick = frame.eventTick(i);
      newest = Math.max(newest, tick);
      if (tick <= afterTick) continue;
      if (frame.eventType(i) === matchEndType) continue;
      const kind = kinds[frame.eventType(i)];
      // Economy event visual is the billed army, including allied records in a shared frame.
      // Observer perspectives have no local economy alert owner.
      if ((kind === 'massStall' || kind === 'energyStall' || frame.eventType(i) === EventType.StorageFull) &&
        (playerArmy < 0 || frame.eventVisual(i) !== playerArmy)) continue;
      if (!audibleStall && (kind === 'massStall' || kind === 'energyStall')) continue;
      this.indices[this.eventCount++] = i;
    }
    return newest;
  }
  private index(i: number): number { return this.indices[i]!; }
  eventType(i: number): number {
    const index = this.index(i);
    const type = this.frame!.eventType(index);
    return this.kinds[type] === 'unitDeath' && (this.frame!.eventFlags(index) & 4) !== 0 ? COMMANDER_DEATH_AUDIO_TYPE : type;
  }
  eventVisual(i: number): number { return this.frame!.eventVisual(this.index(i)); }
  eventTick(i: number): number { return this.frame!.eventTick(this.index(i)); }
  eventSubTick(i: number): number { return this.frame!.eventSubTick(this.index(i)); }
  eventFlags(i: number): number { return this.frame!.eventFlags(this.index(i)); }
  eventPos(i: number, c: number): number { return this.frame!.eventPos(this.index(i), c); }
  eventAux(i: number): number {
    const index = this.index(i);
    return this.frame!.eventType(index) === EventType.StorageFull ? STORAGE_FULL_ALERT_INDEX : this.frame!.eventAux(index);
  }
  eventHandle(i: number): number { return this.frame!.eventHandle(this.index(i)); }
}

export function commandSound(op: number): string | null {
  switch (op) {
    case Op.Move: case Op.FormationMove: case Op.GroupMove: case Op.SetRally: return 'ui_cmd_move';
    case Op.Attack: case Op.AttackMove: case Op.AttackGround: case Op.Overcharge: return 'ui_cmd_attack';
    case Op.Build: case Op.Upgrade: return 'ui_cmd_build';
    case Op.FactoryQueue: return 'ui_queue_add';
    case Op.Patrol: case Op.Guard: case Op.Assist: case Op.Repair: case Op.Reclaim:
    case Op.Stop: case Op.FireState: case Op.TogglePause: case Op.SetPriority:
    case Op.ToggleAbility: case Op.FactoryRepeat: case Op.SelfDestruct: return 'ui_cmd_generic';
    default: return null;
  }
}

/** Small installable adapter; Game owns when frames, commands and successful UI actions arrive. */
export class GameAudioBridge {
  readonly engine: FafAudioEngine;
  readonly ready: Promise<LoadReport>;
  private readonly commands = new CommandBatchView();
  private readonly events = new FrameEvents();
  private readonly economy: EconomyAudio;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;
  private lastEventTick = -1;
  private lastFrameTick = -1;
  private audibleStall = true;
  private alertVoice: GameAudioSettings['alertVoice'] = 'voice';
  private readonly preferences: AudioPreferencesStore;
  private matchEnded = false;
  private activation: Promise<boolean> | null = null;
  private readonly pendingFeedback: string[] = [];
  private activationAt = 0;
  private now(): number { return this.options.engineOptions?.clock?.() ?? performance.now(); }
  private readonly gesture = (event: Event): void => {
    // Synthetic DOM events never authorize autoplay. resume() runs inside the trusted handler.
    if (!event.isTrusted || this.disposed || this.activation !== null || this.engine.state === 'running') return;
    this.activationAt = this.now();
    this.activation = this.engine.unlock();
    void this.activation.then(running => {
      // Only first-gesture UI feedback may wait for resume's microtask, never battle events.
      if (running && !this.disposed && this.now() - this.activationAt <= 100) {
        for (const sound of this.pendingFeedback) this.engine.playUi(sound);
      }
      this.pendingFeedback.length = 0;
      this.activation = null;
    });
  };

  constructor(private readonly options: GameAudioOptions) {
    this.economy = new EconomyAudio(options.playerArmy);
    this.preferences = options.preferencesStore ?? localAudioPreferencesStore();
    const preferences = readAudioPreferences(this.preferences);
    this.audibleStall = preferences.audibleStall;
    this.alertVoice = preferences.alertVoice;
    this.engine = createAudioEngine({
      ...options.engineOptions, baseUrl: options.baseUrl ?? gameAudioBaseUrl(),
      eventTypes: { ...options.eventTypes, [COMMANDER_DEATH_AUDIO_TYPE]: 'commanderDeath' }, visualName: options.visualName, unlockTarget: null,
    });
    this.engine.setAlertMode(this.alertVoice);
    options.gestureTarget.addEventListener('pointerdown', this.gesture, { capture: true, passive: true });
    options.gestureTarget.addEventListener('keydown', this.gesture, { capture: true, passive: true });
    this.ready = this.engine.load({ factions: ['common', this.engine.faction] });
    // Game may show the rejected readiness promise; prevent an unhandled rejection meanwhile.
    void this.ready.catch(() => undefined);
  }

  /** One accepted sim frame, including real protocol events. Call before update(). */
  onFrame(frame: FrameReader): void {
    if (this.disposed) return;
    this.engine.setSimSpeed(frame.speedPermille / 1000);
    const freshTick = frame.tick !== this.lastFrameTick;
    const rewind = frame.tick < this.lastFrameTick;
    if (rewind) {
      // Replay seeks reset the watermark and discard the target frame's historical sounds.
      this.lastEventTick = frame.tick;
      this.economy.reset();
      this.matchEnded = false;
    }
    this.lastFrameTick = frame.tick;
    const afterTick = this.lastEventTick;
    this.lastEventTick = this.events.bind(frame, afterTick, this.options.eventTypes, this.audibleStall, this.options.matchEndType ?? EventType.MatchEnd, this.options.playerArmy);
    if (!rewind && !this.matchEnded) {
      for (let i = 0; i < frame.eventCount; i++) {
        if (frame.eventType(i) !== (this.options.matchEndType ?? EventType.MatchEnd) || frame.eventTick(i) <= afterTick) continue;
        this.matchEnded = true;
        const winner = frame.eventVisual(i);
        if (winner !== 0xffff && this.options.playerArmy >= 0) this.engine.playUi(winner === this.options.playerArmy ? 'mus_victory' : 'mus_defeat');
      }
    }
    if (this.events.eventCount > 0 && !frame.paused) this.engine.handleEvents(this.events);
    if (freshTick || frame.paused) this.economy.update(frame, this.engine, this.options.eventTypes, this.audibleStall && !rewind, afterTick);
  }

  /** Every presentation frame, including pause: spatial listener, alerts, loops and voice tails. */
  update(listener: ListenerState, nowMs?: number): void {
    if (this.disposed) return;
    this.engine.setListener(listener);
    this.engine.update(nowMs);
  }

  /** Local issued-command feedback, never a claim that the sim accepted the order. */
  onCommandBatch(batch: Uint8Array): void {
    if (this.disposed || this.options.replayMode) return;
    this.commands.reset(batch);
    let played = false;
    while (this.commands.next()) {
      const c = this.commands;
      if (c.army !== this.options.playerArmy || c.tick !== 0 || c.unitCount === 0) continue;
      const sound = commandSound(c.op);
      if (sound === null || played) continue;
      this.feedback(sound);
      this.feedback(this.options.acknowledgement?.(c.unitAt(0)) ?? 'ack_pip_direct');
      played = true;
    }
  }

  private feedback(sound: string): void {
    if (this.activation !== null && this.engine.state !== 'running') {
      if (this.pendingFeedback.length < 4) this.pendingFeedback.push(sound);
    } else this.engine.playUi(sound);
  }
  select(count: number): void { if (!this.disposed && count > 0) this.feedback('ui_select'); }
  click(): void { if (!this.disposed) this.feedback('ui_click'); }
  error(): void { if (!this.disposed) this.feedback('ui_error'); }
  preview(): void { this.click(); }
  setSettings(patch: Partial<AudioSettings>): void { if (!this.disposed) this.engine.settings.set(patch); }
  hudSettings(): GameAudioSettings { return audioHudSettings(this.engine.settings.get(), this.audibleStall, this.alertVoice); }
  setHudSetting(key: string, value: unknown): boolean {
    if (this.disposed) return false;
    const patch = audioSettingsPatch(key, value);
    if (patch !== null) { this.setSettings(patch); return true; }
    if (key === 'audibleStall' && typeof value === 'boolean') {
      this.audibleStall = value;
      this.savePreferences();
      return true;
    }
    if (key === 'alertVoice' && (value === 'voice' || value === 'gong' || value === 'off')) {
      this.alertVoice = value;
      this.engine.setAlertMode(value);
      this.savePreferences();
      return true;
    }
    return false;
  }
  private savePreferences(): void {
    try { this.preferences.save({ audibleStall: this.audibleStall, alertVoice: this.alertVoice }); }
    catch { /* Persistence is best effort; playback policy already changed. */ }
  }
  dispose(): Promise<void> {
    if (this.disposePromise !== null) return this.disposePromise;
    this.disposed = true;
    this.pendingFeedback.length = 0;
    this.options.gestureTarget.removeEventListener('pointerdown', this.gesture, true);
    this.options.gestureTarget.removeEventListener('keydown', this.gesture, true);
    this.disposePromise = this.engine.dispose();
    return this.disposePromise;
  }
}

export function installGameAudio(options: GameAudioOptions): GameAudioBridge { return new GameAudioBridge(options); }
