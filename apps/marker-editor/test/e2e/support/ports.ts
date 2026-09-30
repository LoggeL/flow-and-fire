/**
 * E2E server port of the marker editor: FAF_E2E_PORT or 4783 (the game's E2E uses 4183/4184).
 * Shared by apps/marker-editor/playwright.config.ts and the specs.
 */
function editorPort(): number {
  const raw = process.env['FAF_E2E_PORT'];
  if (raw === undefined || raw === '') return 4783;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`FAF_E2E_PORT invalid: ${raw}`);
  return n;
}

export const EDITOR_PORT = editorPort();
export const EDITOR_ORIGIN = `http://localhost:${EDITOR_PORT}`;
