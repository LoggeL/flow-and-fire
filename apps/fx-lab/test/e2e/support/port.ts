/**
 * Port of the fx-lab E2E preview server, shared by apps/fx-lab/playwright.config.ts and the specs.
 * Default 4683 (the game E2E uses 4183/4184, the fx-lab dev server 4685); FAF_E2E_PORT overrides it.
 */
function e2ePort(): number {
  const raw = process.env['FAF_E2E_PORT'];
  if (raw === undefined || raw === '') return 4683;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535 || String(n) !== raw.trim()) throw new Error(`FAF_E2E_PORT invalid: ${raw}`);
  if (n === 5199) throw new Error('FAF_E2E_PORT 5199 is reserved for the user');
  return n;
}

export const FX_E2E_PORT = e2ePort();
export const FX_E2E_ORIGIN = `http://127.0.0.1:${FX_E2E_PORT}`;
