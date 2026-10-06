/**
 * Top bar: open / bundled map selection / save / markers.json export, undo/redo with depth, file
 * name with dirty mark, fit view and help.
 */
import type { Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { EditorStore } from '../../app/store.ts';
import { S } from '../strings.ts';
import type { PanelIo } from '../types.ts';
import { releaseFocus, releaseFocusAfterClick } from './inputs.tsx';

/** Map name of a file name ("hollow-ridge.rtsmap" -> "hollow-ridge"). */
export function mapNameOf(fileName: string | null): string {
  if (fileName === null) return '';
  const base = fileName.replace(/^.*[\\/]/, '');
  return base.toLowerCase().endsWith('.rtsmap') ? base.slice(0, -'.rtsmap'.length) : base;
}

type BundledState = { readonly state: 'loading' } | { readonly state: 'ready'; readonly names: readonly string[] } | { readonly state: 'failed' };

export function TopBar(props: { readonly store: EditorStore; readonly io: PanelIo; readonly helpOpen: Signal<boolean> }): JSX.Element {
  const { store, io, helpOpen } = props;
  const [bundled, setBundled] = useState<BundledState>({ state: 'loading' });

  useEffect(() => {
    let alive = true;
    io.listBundled().then(
      (names) => {
        if (alive) setBundled({ state: 'ready', names });
      },
      () => {
        if (alive) setBundled({ state: 'failed' });
      },
    );
    return () => {
      alive = false;
    };
  }, [io]);

  const hasDoc = store.doc.value !== null;
  const fileName = store.fileName.value;
  const dirty = store.dirty.value;
  const current = mapNameOf(fileName);
  const names = bundled.state === 'ready' ? bundled.names : [];
  const selected = names.includes(current) ? current : '';

  const onSelectMap = (e: JSX.TargetedEvent<HTMLSelectElement>): void => {
    const name = e.currentTarget.value;
    releaseFocus(e);
    if (name === '') return;
    io.openBundled(name).catch((err: unknown) => {
      store.status.value = `Karte ${name} konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}`;
    });
  };

  const undoDepth = store.undoDepth.value;
  const redoDepth = store.redoDepth.value;

  return (
    <header class="me-topbar" data-testid="top-bar">
      <div class="me-brand">
        <span class="me-brand-mark" aria-hidden="true" />
        <span>{S.appTitle}</span>
      </div>
      <div class="me-group">
        <button
          type="button"
          class="me-btn"
          data-testid="btn-open"
          title={S.openTitle}
          onClick={(e) => {
            releaseFocusAfterClick(e);
            io.openFile();
          }}
        >
          {S.open}
        </button>
        <select class="me-select me-map-select" data-testid="select-map" aria-label={S.mapSelect} value={selected} onChange={onSelectMap} disabled={bundled.state !== 'ready'}>
          <option value="">{bundled.state === 'loading' ? S.mapSelectLoading : bundled.state === 'failed' ? S.mapSelectFailed : S.mapSelectPlaceholder}</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="me-btn me-btn-primary"
          data-testid="btn-save"
          title={S.saveTitle}
          disabled={!hasDoc}
          onClick={(e) => {
            releaseFocusAfterClick(e);
            io.save();
          }}
        >
          {S.save}
        </button>
        <button
          type="button"
          class="me-btn"
          data-testid="btn-export-markers"
          title={S.exportMarkersTitle}
          disabled={!hasDoc}
          onClick={(e) => {
            releaseFocusAfterClick(e);
            io.exportMarkersJson();
          }}
        >
          {S.exportMarkers}
        </button>
        <button
          type="button"
          class="me-btn"
          data-testid="btn-export-overlay"
          title={S.exportOverlayTitle}
          disabled={!hasDoc}
          onClick={(e) => {
            releaseFocusAfterClick(e);
            io.exportEditorOverlay();
          }}
        >
          {S.exportOverlay}
        </button>
      </div>
      <div class="me-group">
        <button
          type="button"
          class="me-btn"
          data-testid="btn-undo"
          title={S.undoTitle}
          disabled={!store.canUndo.value}
          onClick={(e) => {
            releaseFocusAfterClick(e);
            store.undo();
          }}
        >
          ↶ {S.undo} <span class="me-badge">{undoDepth}</span>
        </button>
        <button
          type="button"
          class="me-btn"
          data-testid="btn-redo"
          title={S.redoTitle}
          disabled={!store.canRedo.value}
          onClick={(e) => {
            releaseFocusAfterClick(e);
            store.redo();
          }}
        >
          ↷ {S.redo} <span class="me-badge">{redoDepth}</span>
        </button>
      </div>
      <div class="me-file" data-testid="file-name" title={dirty ? S.dirtyTitle : undefined}>
        {fileName ?? S.noFile}
        {dirty ? <span class="me-dirty-mark">{S.dirtyMark}</span> : null}
      </div>
      <div class="me-group me-group-end">
        <button
          type="button"
          class="me-btn"
          data-testid="btn-fit"
          title={S.fitTitle}
          disabled={!hasDoc}
          onClick={(e) => {
            releaseFocusAfterClick(e);
            io.fitView();
          }}
        >
          {S.fit}
        </button>
        <button
          type="button"
          class={`me-btn${helpOpen.value ? ' me-active' : ''}`}
          data-testid="btn-help"
          title={S.helpTitle}
          aria-pressed={helpOpen.value}
          onClick={(e) => {
            releaseFocusAfterClick(e);
            helpOpen.value = !helpOpen.value;
          }}
        >
          ? {S.help}
        </button>
      </div>
    </header>
  );
}
