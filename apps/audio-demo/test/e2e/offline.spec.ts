import { expect, test } from './support.ts';
import type { OfflineApi, OfflineCaseName } from '../../src/offline/cases.ts';
declare global { interface Window { __fafAudioOffline?: OfflineApi; } }
for (const name of ['decode', 'pan', 'bus', 'limiter', 'loop', 'limits'] as const) test(`real OfflineAudioContext: ${name}`, async ({ page }, info) => {
  await page.goto('/offline.html');
  const result = await page.evaluate(async (n: OfflineCaseName) => { const api = window.__fafAudioOffline!; await api.ready; return api.run(n); }, name);
  info.annotations.push({ type: 'audio-result', description: JSON.stringify(result) });
  expect(result.failures).toEqual([]);
  if (result.name === 'decode') { expect(result.files.filter(f => f.lengthOk).length).toBeGreaterThanOrEqual(12); info.annotations.push({ type: 'decode-paths', description: JSON.stringify(result.byPath) }); }
});
