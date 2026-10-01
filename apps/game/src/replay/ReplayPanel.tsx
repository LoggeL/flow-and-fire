import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ReplayController } from './controller.ts';
import { downloadReplay, loadReplayLabels, recordingDate, saveReplayLabel, type RecordedGame, type ReplayAssets, type ReplayLibrary } from './library.ts';
import './replay.css';
import { handoffReplayBuild, historicalReplayBuildAvailable } from './compatibility.ts';
import { visibleReplayWorkError } from './startup-failure.ts';

export interface ReplayPanelProps {
  readonly open?: boolean;
  readonly library: ReplayLibrary;
  readonly controller: ReplayController | null;
  readonly assets: ReplayAssets;
  readonly exportCurrentLog: (() => Promise<ArrayBuffer>) | null;
  readonly onOpen: (bytes: Uint8Array) => void | Promise<void>;
  readonly onExit: (() => void) | null;
  /** Settle current-session and audio disposal before leaving for a retained build. */
  readonly beforeHistoricalNavigate: () => Promise<void>;
  /** Resolve the recorded map, never silently substitute the currently displayed map. */
  readonly resolveAssets?: (recording: RecordedGame) => Promise<ReplayAssets>;
  readonly locale?: 'de' | 'en';
  /** Display name of a recorded map, if it is part of the local content. */
  readonly mapName?: (mapSimHash: number) => string | undefined;
}
export function replayTime(ticks: number): string {
  const seconds = Math.floor(ticks / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
// German labels are also contracts of the existing browser checks; English mirrors them.
const TEXT = {
  de: { title: 'Replays', open: 'Replay öffnen', exportCurrent: 'Aktuelles Spiel exportieren', refresh: 'Aufnahmen aktualisieren', play: 'Abspielen', pause: 'Pause',
    back10: '10 s zurück', step: 'Ein Tick', speed: 'Tempo', viewer: 'Perspektive', allArmies: 'Alle Armeen', download: 'Replay herunterladen', exit: 'Zurück zum Hauptmenü',
    pending: 'Prüfung ausstehend: Hashes werden beim Abspielen mit der Aufnahme verglichen.', checked: (rules: number, tables: number) => `${rules} Regel-Hashes, ${tables} Tabellen geprüft.`,
    clean: ' Keine Abweichung.', diverged: (n: number) => ` ${n} Abweichungen.`, tainted: ' Markierte Aufnahme.', truncated: ' Wiederhergestellte Teilaufnahme.',
    divergence: (tick: number, expected: string, actual: string, regions: string) => `Abweichung bei Tick ${tick}: ${expected} / ${actual}, Tabellen: ${regions || 'noch nicht eingegrenzt'}`,
    needsBuild: (route: string) => ` Aufzeichnung benötigt den Build unter ${route}.`, openBuild: 'Aufgezeichneten Build öffnen',
    buildMissing: (route: string) => `Der aufgezeichnete Build unter ${route} ist hier nicht verfügbar. Die Replay-Datei bleibt erhalten.`,
    busy: 'Replay wird verarbeitet…', recovered: 'Aufnahme nach Abbruch wiederhergestellt.', exported: 'Aufnahme exportiert.', verified: 'Hashes geprüft.', unverified: 'Hashes nicht bestätigt.',
    library: 'Gespeicherte Aufnahmen', search: 'Suchen', searchPlaceholder: 'Name, Karte oder Datum', watch: 'Ansehen', export: 'Exportieren', rename: 'Umbenennen', save: 'Speichern',
    cancel: 'Abbrechen', remove: 'Löschen', confirmRemove: 'Endgültig löschen', complete: 'Abgeschlossen', partial: 'Teilaufnahme', marked: 'markiert', unknownMap: 'Karte nicht lokal',
    empty: 'Keine gespeicherten Aufnahmen gefunden.', noMatch: 'Keine Aufnahme passt zur Suche.', label: 'Name der Aufnahme', removed: 'Aufnahme gelöscht.' },
  en: { title: 'Replays', open: 'Open replay', exportCurrent: 'Export current match', refresh: 'Refresh recordings', play: 'Play', pause: 'Pause',
    back10: 'Back 10 s', step: 'One tick', speed: 'Speed', viewer: 'Perspective', allArmies: 'All armies', download: 'Download replay', exit: 'Back to main menu',
    pending: 'Check pending: hashes are compared with the recording during playback.', checked: (rules: number, tables: number) => `${rules} rule hashes, ${tables} tables checked.`,
    clean: ' No divergence.', diverged: (n: number) => ` ${n} divergences.`, tainted: ' Marked recording.', truncated: ' Recovered partial recording.',
    divergence: (tick: number, expected: string, actual: string, regions: string) => `Divergence at tick ${tick}: ${expected} / ${actual}, tables: ${regions || 'not narrowed down yet'}`,
    needsBuild: (route: string) => ` The recording needs the build at ${route}.`, openBuild: 'Open recorded build',
    buildMissing: (route: string) => `The recorded build at ${route} is not available here. The replay file is kept.`,
    busy: 'Processing replay…', recovered: 'Recording recovered after an interruption.', exported: 'Recording exported.', verified: 'Hashes checked.', unverified: 'Hashes not confirmed.',
    library: 'Stored recordings', search: 'Search', searchPlaceholder: 'Name, map or date', watch: 'Watch', export: 'Export', rename: 'Rename', save: 'Save',
    cancel: 'Cancel', remove: 'Delete', confirmRemove: 'Delete permanently', complete: 'Complete', partial: 'Partial recording', marked: 'marked', unknownMap: 'map not local',
    empty: 'No stored recordings found.', noMatch: 'No recording matches the search.', label: 'Recording name', removed: 'Recording deleted.' },
} as const;

export function ReplayPanel(props: ReplayPanelProps) {
  const L = TEXT[props.locale ?? 'de'];
  const [visible, setVisible] = useState(props.open === true);
  const [files, setFiles] = useState<readonly RecordedGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [labels, setLabels] = useState(() => loadReplayLabels());
  const [editing, setEditing] = useState<{ readonly name: string; readonly value: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
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
    setNote(`${replay.truncated ? L.recovered : L.exported} ${replay.verified ? L.verified : L.unverified} ${replay.warnings.join(' ')}`);
    if (open) await props.onOpen(replay.bytes); else downloadReplay(replay.bytes, `${(labels[file.name] ?? file.name.replace(/\.faflog$/, '')).replace(/[^\p{L}\p{N}._-]+/gu, '_')}.rtsreplay`);
  });
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(props.locale === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'medium', timeStyle: 'short' }), [props.locale]);
  const describe = (file: RecordedGame) => {
    const date = recordingDate(file.name), map = props.mapName?.(file.mapSimHash);
    return { title: labels[file.name] ?? (date !== null ? dateFormat.format(date) : file.name), date: date !== null ? dateFormat.format(date) : '', map: map ?? L.unknownMap };
  };
  const needle = query.trim().toLocaleLowerCase();
  const shown = files.filter(file => { if (needle === '') return true; const d = describe(file); return `${d.title} ${d.date} ${d.map} ${file.complete ? L.complete : L.partial} ${file.name}`.toLocaleLowerCase().includes(needle); });
  const verified = state !== null && state.result.compared + state.result.subCompared > 0;
  return (
    <section class="replay-panel" data-testid="replay-panel" aria-label={L.title}>
      <button class="replay-toggle" onClick={() => setVisible(!visible)} aria-expanded={visible}>{L.title}</button>
      {visible || controller !== null ? <div class="replay-body">
        <div class="replay-actions">
          <label class="replay-import replay-button">{L.open}<input type="file" accept=".rtsreplay" disabled={busy} data-testid="replay-import"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file !== undefined) void work(async () => { const bytes = new Uint8Array(await file.arrayBuffer()); await props.library.inspect(bytes); await props.onOpen(bytes); });
              event.currentTarget.value = '';
            }} /></label>
          {props.exportCurrentLog !== null ? <button disabled={busy} data-testid="replay-export-current" onClick={() => void work(async () => {
            const replay = await props.library.convert(await props.exportCurrentLog!(), props.assets);
            setNote(`${replay.verified ? L.verified : L.unverified} ${replay.warnings.join(' ')}`);
            downloadReplay(replay.bytes);
          })}>{L.exportCurrent}</button> : null}
          <button disabled={busy} onClick={() => void refresh()}>{L.refresh}</button>
        </div>
        {state !== null ? <div class="replay-controls" data-testid="replay-controls">
          <button class="is-primary" disabled={controller!.seeking.value || state.tick === state.endTick && state.paused} data-testid="replay-play"
            onClick={() => state.paused ? controller!.play() : controller!.pause()}>{state.paused ? L.play : L.pause}</button>
          <button onClick={() => controller!.seek(Math.max(0, state.tick - 100))} disabled={controller!.seeking.value}>{L.back10}</button>
          <button onClick={() => controller!.step()} disabled={controller!.seeking.value || state.tick === state.endTick}>{L.step}</button>
          <label class="replay-field">{L.speed} <select value={state.speed} data-testid="replay-speed" onChange={(event) => controller!.speed(Number(event.currentTarget.value))}>
            {[0.25, 0.5, 1, 2, 3, 5, 10, 20, 32].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
          </select></label>
          <label class="replay-field">{L.viewer} <select value={state.viewer} data-testid="replay-viewer" onChange={(event) => controller!.viewer(Number(event.currentTarget.value))}>
            <option value={-1}>{L.allArmies}</option>{state.armies.map((a) => <option key={a.index} value={a.index}>{a.name}</option>)}
          </select></label>
          <label class="replay-seek"><span>{replayTime(state.tick)} / {replayTime(state.endTick)} <small>(Tick {state.tick})</small></span>
            <input type="range" min={0} max={state.endTick} value={state.tick} step={1} data-testid="replay-seek" disabled={controller!.seeking.value}
              style={{ '--progress': `${state.endTick > 0 ? state.tick / state.endTick * 100 : 0}%` }}
              onChange={(event) => controller!.seek(Number(event.currentTarget.value))} />
          </label>
          {/* No comparison has happened before the first recorded hash tick: say so instead of "no divergence". */}
          <output data-testid="replay-verification" data-state={verified ? (state.result.divergences.length === 0 ? 'clean' : 'diverged') : 'pending'}>{verified ? <>{L.checked(state.result.compared, state.result.subCompared)}
            {state.result.divergences.length === 0 ? L.clean : L.diverged(state.result.divergences.length)}</> : L.pending}
            {state.result.tainted ? L.tainted : ''}{state.result.truncated ? L.truncated : ''}</output>
          {state.result.divergences.slice(0, 5).map((d, index) => <p class="replay-error" key={index}>{L.divergence(d.tick, d.expected.toString(16), d.actual.toString(16), d.regions.join(', '))}</p>)}
          <button onClick={() => downloadReplay(controller!.bytes)}>{L.download}</button>
          {props.onExit !== null ? <button onClick={props.onExit}>{L.exit}</button> : null}
        </div> : null}
        {failure !== null ? <p role="alert" class="replay-error">{failure.message}{failure.route !== null ? <>{L.needsBuild(failure.route)}
          <button disabled={busy} onClick={() => void work(async () => {
            if (failure.buildHash === null || !(await historicalReplayBuildAvailable(failure.buildHash))) throw new Error(L.buildMissing(failure.route!));
            await handoffReplayBuild(controller!.bytes, failure.buildHash, props.beforeHistoricalNavigate,
              route => location.assign(route));
          })}>{L.openBuild}</button></> : null}</p> : null}
        {busy ? <p role="status">{L.busy}</p> : null}
        {workError !== null ? <p role="alert" class="replay-error">{workError}</p> : null}
        {note !== null ? <p role="status">{note}</p> : null}
        {visible ? <>
          <div class="replay-library-head"><b>{L.library}</b><label class="replay-search">{L.search}<input type="search" value={query} placeholder={L.searchPlaceholder} data-testid="replay-search" onInput={(event) => setQuery(event.currentTarget.value)}/></label></div>
          <ul class="replay-library" data-testid="replay-library">{shown.map((file) => { const d = describe(file); return <li key={file.name} data-name={file.name}>
            {editing?.name === file.name ? <form class="replay-rename" onSubmit={(event) => { event.preventDefault(); setLabels(saveReplayLabel(file.name, editing.value)); setEditing(null); }}>
              <input aria-label={L.label} value={editing.value} maxLength={80} data-testid="replay-rename-input" onInput={(event) => setEditing({ name: file.name, value: event.currentTarget.value })}/>
              <button type="submit">{L.save}</button><button type="button" onClick={() => setEditing(null)}>{L.cancel}</button></form>
              : <span class="replay-entry"><b>{d.title}</b><small>{[d.map, replayTime(file.endTick), file.complete ? L.complete : L.partial, file.tainted ? L.marked : ''].filter(Boolean).join(' · ')}{labels[file.name] && d.date ? ` · ${d.date}` : ''}</small></span>}
            {file.error === null ? <><button disabled={busy} onClick={() => void exportLog(file, true)}>{L.watch}</button><button disabled={busy} onClick={() => void exportLog(file, false)}>{L.export}</button></> : <span class="replay-error">{file.error}</span>}
            <button disabled={busy} onClick={() => setEditing({ name: file.name, value: labels[file.name] ?? '' })}>{L.rename}</button>
            {confirming === file.name ? <button class="is-danger" disabled={busy} data-testid="replay-delete-confirm" onClick={() => void work(async () => {
              await props.library.delete(file.name); setConfirming(null); setLabels(saveReplayLabel(file.name, '')); setFiles(await props.library.list()); setNote(L.removed);
            })}>{L.confirmRemove}</button> : <button disabled={busy} onClick={() => setConfirming(file.name)}>{L.remove}</button>}
          </li>; })}{files.length === 0 && !busy ? <li>{L.empty}</li> : files.length > 0 && shown.length === 0 ? <li>{L.noMatch}</li> : null}</ul>
        </> : null}
      </div> : null}
    </section>
  );
}
