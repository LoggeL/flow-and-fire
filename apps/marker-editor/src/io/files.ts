/**
 * Browser file IO: downloads (Blob + a[download]), the hidden file input for "Öffnen" and
 * drag & drop of .rtsmap files onto the window.
 */

/** Offers `data` as a download named `fileName`. */
export function downloadData(data: Uint8Array | string, fileName: string, type: string): void {
  let part: BlobPart;
  if (typeof data === 'string') {
    part = data;
  } else {
    const copy = new Uint8Array(new ArrayBuffer(data.length));
    copy.set(data);
    part = copy;
  }
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Hidden <input type=file accept=.rtsmap> (data-testid file-input); `open()` shows the dialog. */
export class FilePicker {
  readonly input: HTMLInputElement;

  constructor(parent: HTMLElement, onFile: (file: File) => void) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.rtsmap';
    input.hidden = true;
    input.dataset['testid'] = 'file-input';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      // Reset so choosing the same file again fires another change.
      input.value = '';
      if (f !== undefined) onFile(f);
    });
    parent.append(input);
    this.input = input;
  }

  open(): void {
    this.input.click();
  }

  dispose(): void {
    this.input.remove();
  }
}

function hasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (types === undefined) return false;
  for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
  return false;
}

/**
 * Accepts files dropped anywhere on the window; `highlight` gets the class `drop-active` while a
 * file is dragged over. Returns the uninstall function.
 */
export function installDropTarget(highlight: HTMLElement, onFile: (file: File) => void): () => void {
  let depth = 0;
  const set = (on: boolean): void => {
    highlight.classList.toggle('drop-active', on);
  };
  const onEnter = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    set(true);
  };
  const onOver = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
  };
  const onLeave = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) set(false);
  };
  const onDrop = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    set(false);
    const f = e.dataTransfer?.files[0];
    if (f !== undefined) onFile(f);
  };
  window.addEventListener('dragenter', onEnter);
  window.addEventListener('dragover', onOver);
  window.addEventListener('dragleave', onLeave);
  window.addEventListener('drop', onDrop);
  return () => {
    window.removeEventListener('dragenter', onEnter);
    window.removeEventListener('dragover', onOver);
    window.removeEventListener('dragleave', onLeave);
    window.removeEventListener('drop', onDrop);
    set(false);
  };
}

/** Bytes of a File (File.arrayBuffer). */
export async function readFileBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
