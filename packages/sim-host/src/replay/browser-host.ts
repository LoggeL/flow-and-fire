/** Browser replay worker adapter. It publishes the same frame transport as the live host. */
import { createFrameProducer, FrameFlags, FrameWriter, isFrameReturnMsg, MAX_WATCH, messageData, parseCtlMessage, type FrameProducer, type InitMessage, type PortLike } from '@faf/protocol';
import { writeFrame } from '@faf/sim';
import type { HostReadyMsg, HostStatusMsg } from '../host.ts';
import { ReplayCompatError, ReplayPlayer, type ReplayVerifyResult } from './player.ts';

export interface BrowserReplayState {
  readonly t: 'replay-state';
  readonly tick: number; readonly endTick: number; readonly paused: boolean; readonly speed: number;
  readonly viewer: number; readonly armies: readonly { index: number; name: string }[];
  readonly result: ReplayVerifyResult;
}
export interface BrowserReplayHostOptions {
  readonly port: PortLike;
  readonly now?: () => number;
  readonly autoStart?: boolean;
}
/** No live commands enter this host. Seeking always uses ReplayPlayer's recorded hashes. */
export class BrowserReplayHost {
  player: ReplayPlayer | null = null;
  private bytes: Uint8Array | null = null;
  private producer: FrameProducer | null = null;
  private readonly writer = new FrameWriter();
  private readonly now: () => number;
  private paused = true;
  private speed = 1;
  private viewer = -1;
  private readonly watchHandles = new Uint32Array(MAX_WATCH);
  private watchCount = 0;
  private seq = 0;
  private last = 0;
  private debt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private republishPending = false;
  private readonly returned: (ev: object) => void;
  constructor(private readonly options: BrowserReplayHostOptions) {
    this.now = options.now ?? (() => performance.now());
    this.returned = (ev) => { if (this.republishPending && isFrameReturnMsg(messageData(ev))) this.publishFrame(); };
    options.port.addEventListener('message', this.returned);
  }
  handleMessage(input: unknown): void {
    if (this.disposed || typeof input !== 'object' || input === null) return;
    const m = input as { t?: string; bytes?: ArrayBuffer; tick?: number; ticks?: number; speed?: number; army?: number };
    try {
      switch (m.t) {
        case 'replay-load':
          if (this.player !== null || !(m.bytes instanceof ArrayBuffer)) throw new Error('Replay must be loaded before init');
          this.bytes = new Uint8Array(m.bytes); break;
        case 'init': this.init(input as InitMessage); break;
        case 'pause': this.paused = true; this.debt = 0; this.publish(); break;
        case 'resume':
          this.requirePlayer(); this.paused = this.player!.tick >= this.player!.endTick;
          this.last = this.now(); this.publish(); this.schedule(); break;
        case 'speed':
          if (!Number.isFinite(m.speed) || m.speed! < 0.25 || m.speed! > 32) throw new RangeError('Replay speed must be between 0.25 and 32');
          this.speed = m.speed!; this.debt = 0; this.last = this.now(); this.publish(); break;
        case 'viewer':
          if (!Number.isInteger(m.army) || m.army! < -1 || m.army! >= this.requirePlayer().world.armyCount) throw new RangeError('Invalid replay army');
          if (this.viewer !== m.army) this.watchCount = 0;
          this.viewer = m.army!; this.publish(); break;
        case 'step':
          if (!Number.isInteger(m.ticks) || m.ticks! < 1) throw new RangeError('Invalid replay step count');
          this.paused = true; this.requirePlayer().step(m.ticks!); this.publish(); break;
        case 'replay-seek':
          this.paused = true; this.debt = 0; this.requirePlayer().seek(m.tick!); this.publish(); break;
        case 'replay-inspect': this.state(); break;
        case 'watch': {
          this.requirePlayer();
          const watch = parseCtlMessage(input);
          if (watch?.t !== 'watch') throw new RangeError(`Invalid replay watch handles (maximum ${MAX_WATCH})`);
          const handles = [...new Set(watch.handles)];
          this.watchHandles.set(handles); this.watchCount = handles.length;
          // Inspection changes are visible even when the replay clock stands still.
          if (this.paused) this.publishFrame();
          break;
        }
        case 'debug': case 'frameReturn': break;
        case 'cmd': case 'devReload': throw new Error('Replay playback does not accept live commands or blueprint reloads');
        case 'exportLog': throw new Error('Export the original replay from the replay panel');
      }
    } catch (error) {
      this.paused = true;
      this.options.port.postMessage({ t: 'error', message: error instanceof Error ? error.message : String(error),
        ...(error instanceof ReplayCompatError ? { replayBuild: error.buildHash, replayRoute: `/b/${encodeURIComponent(error.buildHash)}/` } : {}) }, []);
    }
  }
  private requirePlayer(): ReplayPlayer { if (this.player === null) throw new Error('Replay is not initialized'); return this.player; }
  private init(m: InitMessage): void {
    if (this.bytes === null || this.player !== null) throw new Error('Load one replay before init');
    if (m.frameCapacity < this.writer.capacityBytes) throw new RangeError('Replay frame capacity too small');
    const p = ReplayPlayer.open(this.bytes, { buildHash: m.buildHash, simBin: new Uint8Array(m.simBin), ...(m.map === undefined ? {} : { map: new Uint8Array(m.map) }) });
    const producer = createFrameProducer({ kind: m.transport, capacity: m.frameCapacity, sab: m.frameSab, port: this.options.port });
    this.player = p; this.producer = producer; this.last = this.now();
    const ready: HostReadyMsg = { t: 'ready', simId: p.sim.simId, layoutHash: p.world.layoutHash, transport: m.transport,
      simBuild: p.replay.head.simBuild, bpSimHash: p.world.bp.simHash, mapSimHash: p.replay.head.mapSimHash,
      mapName: p.replay.game.mapName, mapSizeWu: p.world.mapSizeWu, seed: p.world.seed, tick: p.tick, navStaticMs: 0, navDerivedMs: 0 };
    this.options.port.postMessage(ready, []); this.publish();
  }
  /** One bounded wall-clock slice. Public for deterministic adapter tests. */
  pump(): void {
    const p = this.requirePlayer(), now = this.now();
    if (this.paused) { this.last = now; return; }
    this.debt += Math.max(0, now - this.last) * this.speed / 100; this.last = now;
    const stop = now + 8;
    let ran = 0;
    while (this.debt >= 1 && p.tick < p.endTick && (ran === 0 || this.now() < stop) && ran < 256) {
      p.step(); this.debt--; ran++;
    }
    if (p.tick >= p.endTick) { this.paused = true; this.debt = 0; }
    if (ran > 0 || this.paused) this.publish();
  }
  private schedule(): void {
    if (this.options.autoStart === false || this.paused || this.disposed || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.pump(); } catch (error) { this.paused = true; this.options.port.postMessage({ t: 'error', message: String(error) }, []); }
      this.schedule();
    }, 16);
  }
  private publishFrame(): void {
    if (this.player === null || this.producer === null || this.disposed) return;
    const dropped = this.producer.dropped;
    const len = writeFrame(this.player.world, this.viewer, this.writer, this.producer.begin(),
      { seq: ++this.seq, tickTimeUs: 0, speedPermille: Math.round(this.speed * 1000), flags: this.paused ? FrameFlags.Paused : 0 }, this.watchHandles, this.watchCount);
    this.producer.commit(len);
    this.republishPending = this.producer.dropped > dropped;
  }
  private publish(): void { this.publishFrame(); this.state(); }
  private state(): void {
    const p = this.player; if (p === null) return;
    const result = p.result();
    const status: HostStatusMsg = { t: 'status', ai: null, tick: p.tick, paused: this.paused, speed: this.speed, ticksBehind: Math.floor(this.debt),
      recorder: 'memory', recorderNote: 'Replay playback', tainted: result.tainted, lostTicks: 0, waiting: false,
      framesDropped: this.producer?.dropped ?? 0, logBytes: this.bytes?.length ?? 0, simHash: p.world.bp.simHash,
      simId: p.sim.simId, devReloads: 0, devReloadMs: 0, navPrecomputeMs: 0 };
    this.options.port.postMessage(status, []);
    const state: BrowserReplayState = { t: 'replay-state', tick: p.tick, endTick: p.endTick, paused: this.paused, speed: this.speed,
      viewer: this.viewer, armies: p.replay.game.armies.map((a) => ({ index: a.index, name: a.name })), result };
    this.options.port.postMessage(state, []);
  }
  dispose(): void {
    this.disposed = true; if (this.timer !== null) clearTimeout(this.timer);
    this.producer?.close(); this.options.port.removeEventListener('message', this.returned);
  }
}
