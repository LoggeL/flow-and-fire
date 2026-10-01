/**
 * Preact overlay (DOM, independent of the WebGL canvas — it survives a context loss): HUD, pause
 * banner, selection rectangle, dev console and phase-budget overlay.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { ConsoleHistory } from '../console-commands.ts';
import type { Game } from '../game.ts';
import { LiveGameHud } from '../hud/LiveHud.tsx';
import type { GameHudPorts, MatchResult } from '../hud/live.ts';

function fmtMs(v: number | null, digits = 2): string {
  return v === null || !Number.isFinite(v) ? '–' : `${v.toFixed(digits)} ms`;
}

function fmtCursor(c: { x: number; y: number; z: number; hit: boolean } | null): string {
  if (c === null) return '–';
  return `${c.x.toFixed(1)}, ${c.y.toFixed(2)}, ${c.z.toFixed(1)}${c.hit ? '' : ' (Rand)'}`;
}

function hex32(v: number | null): string {
  return v === null ? '–' : '0x' + (v >>> 0).toString(16).padStart(8, '0');
}

export function Hud({ game }: { game: Game }) {
  const h = game.hud.value;
  return (
    <div class="faf-hud" data-testid="diagnostic-hud">
      <div class="faf-hud-title">Flow &amp; Fire <span class="faf-dim">MS3</span></div>
      <table>
        <tbody>
          <tr><th>Tick</th><td data-testid="hud-tick">{h.tick}</td></tr>
          <tr><th>Status</th><td data-testid="hud-state">{!h.ready ? 'lädt …' : h.paused ? 'Pause' : 'läuft'}</td></tr>
          <tr><th>Speed</th><td data-testid="hud-speed">{h.speed.toFixed(2)}x</td></tr>
          <tr><th>FPS</th><td data-testid="hud-fps">{h.fps.toFixed(0)}</td></tr>
          <tr><th>Sim p95</th><td data-testid="hud-sim-p95">{fmtMs(h.simP95Ms, 3)}</td></tr>
          <tr><th>Main-JS p95</th><td data-testid="hud-main-p95">{fmtMs(h.mainJsP95Ms, 3)}</td></tr>
          <tr><th>Einheiten</th><td data-testid="hud-units">{h.units}{h.selected > 0 ? ` (${h.selected} ausgewählt)` : ''}</td></tr>
          <tr><th>Transport</th><td data-testid="hud-transport">{h.transport}</td></tr>
          <tr><th>Zoom</th><td data-testid="hud-zoom">Z{h.zoom}</td></tr>
          <tr><th>simHash</th><td data-testid="hud-simhash">{hex32(h.simHash)}{h.tainted ? " (tainted)" : ""}</td></tr>
          {h.hmrError !== null ? <tr><th>Blueprint</th><td role="alert">{h.hmrError}</td></tr> : null}
          <tr><th>simId</th><td data-testid="hud-simid">{hex32(h.simId)}</td></tr>
          <tr><th>Build</th><td data-testid="hud-build">{h.buildHash}</td></tr>
          <tr><th>Karte</th><td data-testid="hud-map">{h.mapName}</td></tr>
          <tr><th>mapSimHash</th><td data-testid="hud-mapsimhash">{hex32(h.mapSimHash)}</td></tr>
          <tr><th>Cursor (WU)</th><td data-testid="hud-cursor">{fmtCursor(h.cursor)}</td></tr>
          <tr><th>Preset</th><td data-testid="hud-preset">{h.preset}</td></tr>
        </tbody>
      </table>
      <div class="faf-hint">
        Rechtsklick: bewegen · Linksziehen: auswählen · WASD/Rand/Mitte: Kamera · Strg+Mitte: drehen · H: Start · P: Pause · N: Step · ^/F1: Konsole
      </div>
      {game.client.fullscreen?.supported === true ? (
        <button
          type="button"
          class="faf-button"
          data-testid="fullscreen-button"
          onClick={() => {
            void game.client.toggleFullscreen();
          }}
        >
          {h.fullscreen ? 'Vollbild verlassen' : 'Vollbild (Alt+Enter)'}
        </button>
      ) : null}
    </div>
  );
}

export function Banners({ game }: { game: Game }) {
  const h = game.hud.value;
  const fatal = game.fatal.value;
  return (
    <>
      {h.contextLost ? (
        <div class="faf-banner faf-warn" data-testid="context-lost">Grafikkontext verloren – wird wiederhergestellt …</div>
      ) : null}
      {fatal !== null ? <div class="faf-fatal" data-testid="fatal">{fatal}</div> : null}
    </>
  );
}

export function DragRect({ game }: { game: Game }) {
  const b = game.dragBox.value;
  if (b === null) return null;
  const x = Math.min(b.x0, b.x1);
  const y = Math.min(b.y0, b.y1);
  return <div class="faf-drag" style={{ left: `${x}px`, top: `${y}px`, width: `${Math.abs(b.x1 - b.x0)}px`, height: `${Math.abs(b.y1 - b.y0)}px` }} />;
}

export function Budget({ game }: { game: Game }) {
  if (!game.budgetOpen.value) return null;
  const s = game.stats.value;
  return (
    <div class="faf-budget" data-testid="budget">
      <div class="faf-panel-title">Phasenbudget (Sim-Worker, letzte {s?.samples ?? 0} Ticks)</div>
      {s === null ? (
        <div class="faf-dim">warte auf Statistik (alle 10 Ticks) …</div>
      ) : (
        <table>
          <thead>
            <tr><th>Phase</th><th>p50</th><th>p95</th></tr>
          </thead>
          <tbody>
            <tr class="faf-total"><td>Tick gesamt</td><td>{(s.tickP50Us / 1000).toFixed(3)}</td><td data-testid="budget-tick-p95">{(s.tickP95Us / 1000).toFixed(3)}</td></tr>
            <tr><td>Hash-Tick</td><td>{(s.hashTickP50Us / 1000).toFixed(3)}</td><td data-testid="budget-hash-p95">{(s.hashTickP95Us / 1000).toFixed(3)}</td></tr>
            {s.phases.map((p) => (
              <tr key={p.id} data-phase={p.name}>
                <td>{p.name}</td>
                <td>{(p.p50Us / 1000).toFixed(3)}</td>
                <td>{(p.p95Us / 1000).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div class="faf-dim">ms · Budget Tick ≤ 2 ms p95 · Stand Tick {s?.tick ?? '–'}</div>
    </div>
  );
}

export function DevConsole({ game }: { game: Game }) {
  const open = game.consoleOpen.value;
  const lines = game.consoleLines.value;
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const history = useRef(new ConsoleHistory());

  useEffect(() => {
    const el = input.current;
    if (el === null) return;
    if (open) el.focus();
    else el.blur();
  }, [open]);

  useEffect(() => {
    const el = log.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = text;
      history.current.push(line);
      setText('');
      if (line.trim() !== '') game.execute(line);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setText(history.current.prev());
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setText(history.current.next());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      game.toggleConsole(false);
    }
  };

  return (
    <div class="faf-console" data-testid="console">
      <div class="faf-console-log" ref={log}>
        {lines.map((l) => (
          <div key={l.id} class={`faf-line faf-${l.kind}`}>{l.text}</div>
        ))}
      </div>
      <input
        ref={input}
        data-testid="console-input"
        class="faf-console-input"
        type="text"
        spellcheck={false}
        autocomplete="off"
        placeholder='Befehl eingeben – "help"'
        value={text}
        onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

export function App({ game, ports, result }: { game: Game; ports?: GameHudPorts; result?: MatchResult }) {
  const diagnostics = typeof location !== 'undefined' && new URLSearchParams(location.search).get('diagnostics') === '1';
  return (
    <>
      <LiveGameHud game={game} {...(ports ? { ports } : {})} {...(result ? { result } : {})} />
      <details class="faf-diagnostics" data-testid="diagnostics" hidden={!diagnostics}><summary>Diagnostics</summary><Hud game={game} /></details>
      <Banners game={game} />
      <DragRect game={game} />
      <Budget game={game} />
      <DevConsole game={game} />
    </>
  );
}

/** Minimal screen for boot failures (no game object). */
export function BootError({ message }: { message: string }) {
  return <div class="faf-fatal" data-testid="fatal">{message}</div>;
}
