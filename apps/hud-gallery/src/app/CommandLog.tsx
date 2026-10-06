import type { RecordedCall } from '@faf/hud';
import type { Signal } from '@preact/signals';
import type { JSX } from 'preact';

const MAX_ROWS = 40;

function formatArg(a: unknown): string {
  if (typeof a === 'string') return JSON.stringify(a);
  try {
    const s = JSON.stringify(a);
    return s === undefined ? String(a) : s;
  } catch {
    return String(a);
  }
}

/** Command log bar under the story (gallery chrome, hidden in shot mode). */
export function CommandLog({
  log,
  version,
  onClear,
}: {
  readonly log: readonly RecordedCall[];
  readonly version: Signal<number>;
  readonly onClear: () => void;
}): JSX.Element {
  // Reading the version subscribes this component to command calls.
  void version.value;
  const rows = log.slice(-MAX_ROWS).reverse();
  return (
    <footer class="gal-log" data-testid="gallery-command-log">
      <div class="gal-log__head">
        <b>Befehlsprotokoll</b>
        <span class="gal-muted">{log.length} Aufrufe</span>
        <button type="button" class="gal-btn" onClick={onClear} disabled={log.length === 0}>
          Leeren
        </button>
      </div>
      <ol class="gal-log__list" reversed start={log.length}>
        {rows.length === 0 ? (
          <li class="gal-muted">Noch keine Befehle – mit der Story interagieren.</li>
        ) : (
          rows.map((c, i) => (
            <li key={`${log.length - i}`}>
              <code>
                {c.name}({c.args.map(formatArg).join(', ')})
              </code>
            </li>
          ))
        )}
      </ol>
    </footer>
  );
}
