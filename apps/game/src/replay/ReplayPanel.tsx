import { useEffect, useState } from 'preact/hooks';
import type { ReplayController } from './controller.ts';
import { downloadReplay, type RecordedGame, type ReplayAssets, type ReplayLibrary } from './library.ts';
import './replay.css';
import { historicalReplayBuildAvailable, stageReplayBuildTransfer } from './compatibility.ts';
import { visibleReplayWorkError } from './startup-failure.ts';

export interface ReplayPanelProps {
  readonly open?: boolean;
  readonly library: ReplayLibrary;
  readonly controller: ReplayController | null;
  readonly assets: ReplayAssets;
  readonly exportCurrentLog: (() => Promise<ArrayBuffer>) | null;
  readonly onOpen: (bytes: Uint8Array) => void | Promise<void>;
  readonly onExit: (() => void) | null;
  /** Resolve the recorded map, never silently substitute the currently displayed map. */
  readonly resolveAssets?: (recording: RecordedGame) => Promise<ReplayAssets>;
}
export function replayTime(ticks: number): string {
  const seconds = Math.floor(ticks / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function ReplayPanel(props: ReplayPanelProps) {
  const [visible, setVisible] = useState(props.open === true);
  const [files, setFiles] = useState<readonly RecordedGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const controller = props.controller, state = controller?.state.value ?? null, failure = controller?.failure.value ?? null;
  const workError = visibleReplayWorkError(error, failure, state !== null);
  useEffect(() => { if (props.open) setVisible(true); }, [props.open]);
  const work = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(null); setNote(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const refresh = (): Promise<void> => work(async () => setFiles(await props.library.list()));
  useEffect(() => { if (visible) void refresh(); }, [visible, props.library]);
  const exportLog = (file: RecordedGame, open: boolean): Promise<void> => work(async () => {
    const assets = props.resolveAssets === undefined ? props.assets : await props.resolveAssets(file);
    const replay = await props.library.export(file.name, assets);
    setNote(`${replay.truncated ? 'Aufnahme nach Abbruch wiederhergestellt.' : 'Aufnahme exportiert.'} ${replay.verified ? 'Hashes geprüft.' : 'Hashes nicht bestätigt.'} ${replay.warnings.join(' ')}`);
    if (open) await props.onOpen(replay.bytes); else downloadReplay(replay.bytes, file.name.replace(/\.faflog$/, '.rtsreplay'));
  });
  return (
    <section class="replay-panel" data-testid="replay-panel" aria-label="Replays">
      <button class="replay-toggle" onClick={() => setVisible(!visible)} aria-expanded={visible}>Replays</button>
      {visible || controller !== null ? <div class="replay-body">
        <div class="replay-actions">
          <label class="replay-import">Replay öffnen<input type="file" accept=".rtsreplay" disabled={busy} data-testid="replay-import"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file !== undefined) void work(async () => { const bytes = new Uint8Array(await file.arrayBuffer()); await props.library.inspect(bytes); await props.onOpen(bytes); });
              event.currentTarget.value = '';
            }} /></label>
          {props.exportCurrentLog !== null ? <button disabled={busy} data-testid="replay-export-current" onClick={() => void work(async () => {
            const replay = await props.library.convert(await props.exportCurrentLog!(), props.assets);
            setNote(`${replay.verified ? 'Hashes geprüft.' : 'Hashes nicht bestätigt.'} ${replay.warnings.join(' ')}`);
            downloadReplay(replay.bytes);
          })}>Aktuelles Spiel exportieren</button> : null}
          <button disabled={busy} onClick={() => void refresh()}>Aufnahmen aktualisieren</button>
        </div>
        {state !== null ? <div class="replay-controls" data-testid="replay-controls">
          <button disabled={controller!.seeking.value || state.tick === state.endTick && state.paused} data-testid="replay-play"
            onClick={() => state.paused ? controller!.play() : controller!.pause()}>{state.paused ? 'Abspielen' : 'Pause'}</button>
          <button onClick={() => controller!.seek(Math.max(0, state.tick - 100))} disabled={controller!.seeking.value}>10 s zurück</button>
          <button onClick={() => controller!.step()} disabled={controller!.seeking.value || state.tick === state.endTick}>Ein Tick</button>
          <label>Tempo <select value={state.speed} data-testid="replay-speed" onChange={(event) => controller!.speed(Number(event.currentTarget.value))}>
            {[0.25, 0.5, 1, 2, 3, 5, 10, 20, 32].map((speed) => <option key={speed} value={speed}>{speed}x</option>)}
          </select></label>
          <label>Perspektive <select value={state.viewer} data-testid="replay-viewer" onChange={(event) => controller!.viewer(Number(event.currentTarget.value))}>
            <option value={-1}>Alle Armeen</option>{state.armies.map((a) => <option key={a.index} value={a.index}>{a.name}</option>)}
          </select></label>
          <label class="replay-seek">{replayTime(state.tick)} / {replayTime(state.endTick)} (Tick {state.tick})
            <input type="range" min={0} max={state.endTick} value={state.tick} step={1} data-testid="replay-seek" disabled={controller!.seeking.value}
              onChange={(event) => controller!.seek(Number(event.currentTarget.value))} />
          </label>
          <output data-testid="replay-verification">{state.result.compared} Regel-Hashes, {state.result.subCompared} Tabellen geprüft.
            {state.result.divergences.length === 0 ? ' Keine Abweichung.' : ` ${state.result.divergences.length} Abweichungen.`}
            {state.result.tainted ? ' Markierte Aufnahme.' : ''}{state.result.truncated ? ' Wiederhergestellte Teilaufnahme.' : ''}</output>
          {state.result.divergences.slice(0, 5).map((d, index) => <p class="replay-error" key={index}>Abweichung bei Tick {d.tick}: {d.expected.toString(16)} / {d.actual.toString(16)}, Tabellen: {d.regions.join(', ') || 'noch nicht eingegrenzt'}</p>)}
          <button onClick={() => downloadReplay(controller!.bytes)}>Replay herunterladen</button>
          {props.onExit !== null ? <button onClick={props.onExit}>Zurück zum Hauptmenü</button> : null}
        </div> : null}
        {failure !== null ? <p role="alert" class="replay-error">{failure.message}{failure.route !== null ? <> Aufzeichnung benötigt den Build unter {failure.route}.
          <button disabled={busy} onClick={() => void work(async () => {
            if (failure.buildHash === null || !(await historicalReplayBuildAvailable(failure.buildHash))) throw new Error(`Der aufgezeichnete Build unter ${failure.route} ist hier nicht verfügbar. Die Replay-Datei bleibt erhalten.`);
            location.assign(stageReplayBuildTransfer(controller!.bytes, failure.buildHash));
          })}>Aufgezeichneten Build öffnen</button></> : null}</p> : null}
        {busy ? <p role="status">Replay wird verarbeitet…</p> : null}
        {workError !== null ? <p role="alert" class="replay-error">{workError}</p> : null}
        {note !== null ? <p role="status">{note}</p> : null}
        {visible ? <ul class="replay-library" data-testid="replay-library">{files.map((file) => <li key={file.name}>
          <span>{file.name} · {replayTime(file.endTick)} · {file.complete ? 'Abgeschlossen' : 'Teilaufnahme'}{file.tainted ? ' · markiert' : ''}</span>
          {file.error === null ? <><button disabled={busy} onClick={() => void exportLog(file, true)}>Ansehen</button><button disabled={busy} onClick={() => void exportLog(file, false)}>Exportieren</button></> : <span class="replay-error">{file.error}</span>}
        </li>)}{files.length === 0 && !busy ? <li>Keine gespeicherten Aufnahmen gefunden.</li> : null}</ul> : null}
      </div> : null}
    </section>
  );
}
