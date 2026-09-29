/**
 * E2E server ports, shared by playwright.config.ts and the specs.
 * Default 4183 (COOP/COEP) / 4184 (plain): 4173 is Vite's preview default and is often taken by other
 * local servers. Override with FAF_E2E_PORT=<n> (the plain server uses n + 1).
 */
function basePort(): number {
  const raw = process.env['FAF_E2E_PORT'];
  if (raw === undefined || raw === '') return 4183;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65534) throw new Error(`FAF_E2E_PORT invalid: ${raw}`);
  return n;
}

export const COI_PORT = basePort();
export const NO_COI_PORT = COI_PORT + 1;
export const COI_ORIGIN = `http://localhost:${COI_PORT}`;
export const NO_COI_ORIGIN = `http://localhost:${NO_COI_PORT}`;
