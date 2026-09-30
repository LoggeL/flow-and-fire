/**
 * offline.html: exposes the real-(Offline)AudioContext test cases as `window.__fafAudioOffline`
 * (contract in docs/status/audioeng-c2.md) and, with `?run=all` or `?run=<case>`, runs them and
 * prints the results on the page.
 */
import { audioBaseUrl } from '../shared/assets.ts';
import { OFFLINE_CASES, OfflineBench, runCase, type OfflineApi, type OfflineCaseName, type OfflineResult } from './cases.ts';

declare global {
  interface Window {
    __fafAudioOffline?: OfflineApi;
  }
}

const out = document.getElementById('out')!;
const benchPromise = OfflineBench.create(audioBaseUrl());

function isCase(s: string): s is OfflineCaseName {
  return (OFFLINE_CASES as readonly string[]).includes(s);
}

const api: OfflineApi = {
  ready: benchPromise.then(() => undefined),
  cases: OFFLINE_CASES,
  async run(name: OfflineCaseName): Promise<OfflineResult> {
    if (!isCase(name)) throw new Error(`unknown case '${String(name)}' (known: ${OFFLINE_CASES.join(', ')})`);
    return runCase(await benchPromise, name);
  },
};
window.__fafAudioOffline = api;

function show(lines: string[]): void {
  out.textContent = lines.join('\n');
}

async function autorun(): Promise<void> {
  const param = new URL(location.href).searchParams.get('run');
  await api.ready;
  if (param === null) {
    show([`bereit – Fälle: ${OFFLINE_CASES.join(', ')}`, 'Start mit ?run=all oder ?run=<fall>']);
    return;
  }
  const names = param === 'all' ? [...OFFLINE_CASES] : param.split(',').filter(isCase);
  const lines: string[] = [];
  for (const n of names) {
    lines.push(`… ${n}`);
    show(lines);
    const r = await api.run(n);
    lines[lines.length - 1] = `${r.failures.length === 0 ? 'OK  ' : 'FAIL'} ${n} (${r.ms} ms)`;
    for (const f of r.failures) lines.push(`     ${f}`);
    lines.push(JSON.stringify(r, null, 1));
    show(lines);
  }
}

autorun().catch((e: unknown) => {
  out.classList.add('err');
  out.textContent = `Fehler: ${String(e)}`;
});
