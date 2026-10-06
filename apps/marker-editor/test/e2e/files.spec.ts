/**
 * Loading files through the real DOM wiring (review TRACK-EDITOR): the "Öffnen …" button opens the
 * hidden input[type=file] (Playwright filechooser), and a DataTransfer with a File dropped on the
 * window goes through installDropTarget (dragenter highlight, drop, .rtsmap filter). Afterwards the
 * map name, the export hash (== the file's bytes) and the undo depth 0 must hold.
 */
import { expect, test, type Page } from '@playwright/test';
import { exportHash, focusCanvas, hashOf, mapFile, undoDepth, waitForMap } from './support/actions.ts';
import { captureErrors, expectNoErrors, openEditor } from './support/editor.ts';

/** Drops `bytes` as a File named `fileName` onto the page (dragenter → dragover → drop on the canvas). */
async function dropFile(page: Page, bytes: Uint8Array, fileName: string): Promise<{ highlighted: boolean; prevented: boolean }> {
  return page.evaluate(
    ([data, name]) => {
      const file = new File([new Uint8Array(data as number[])], name as string, { type: 'application/octet-stream' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.getElementById('terrain')!;
      const fire = (type: string): DragEvent => {
        const e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
        // Engines that ignore the dataTransfer init member still get the transfer object.
        if (e.dataTransfer === null) Object.defineProperty(e, 'dataTransfer', { value: dt });
        target.dispatchEvent(e);
        return e;
      };
      fire('dragenter');
      fire('dragover');
      const highlighted = document.querySelector('.drop-active') !== null;
      const drop = fire('drop');
      return { highlighted, prevented: drop.defaultPrevented };
    },
    [Array.from(bytes), fileName] as const,
  );
}

async function mapName(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__editor!.mapName);
}

test.describe('marker editor file loading (DOM wiring)', () => {
  test('"Öffnen …" loads the chosen .rtsmap through the file dialog', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page, 'setons');
    const bytes = mapFile('hollow-ridge');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('btn-open').click()]);
    expect(chooser.isMultiple()).toBe(false);
    await chooser.setFiles({ name: 'hollow-ridge.rtsmap', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    await waitForMap(page, 'hollow-ridge');
    expect(await exportHash(page)).toBe(hashOf(bytes));
    expect(await undoDepth(page)).toBe(0);
    await expect(page.getByTestId('status-dirty')).toHaveAttribute('data-dirty', 'false');
    // Ctrl/Cmd+O opens the same dialog.
    await focusCanvas(page);
    const [again] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('ControlOrMeta+o')]);
    await again.setFiles({ name: 'tessera.rtsmap', mimeType: 'application/octet-stream', buffer: Buffer.from(mapFile('tessera')) });
    await waitForMap(page, 'tessera');
    expect(await exportHash(page)).toBe(hashOf(mapFile('tessera')));
    expectNoErrors(errors);
  });

  test('drag & drop of a .rtsmap loads it; other files are rejected with a message', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page, 'hollow-ridge');
    const bytes = mapFile('braidwater');
    const r = await dropFile(page, bytes, 'mein-braidwater.rtsmap');
    expect(r).toEqual({ highlighted: true, prevented: true });
    await waitForMap(page, 'mein-braidwater');
    expect(await exportHash(page)).toBe(hashOf(bytes));
    expect(await undoDepth(page)).toBe(0);
    await expect(page.locator('.drop-active')).toHaveCount(0);

    // Not a .rtsmap: the open map stays, the status line says why.
    await dropFile(page, new Uint8Array([1, 2, 3]), 'notizen.txt');
    await expect(page.getByTestId('status-message')).toContainText('notizen.txt ist keine .rtsmap-Datei');
    expect(await mapName(page)).toBe('mein-braidwater');
    expect(await exportHash(page)).toBe(hashOf(bytes));
    expectNoErrors(errors);
  });
});
