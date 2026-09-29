/** Small DOM helpers shared by the views. */
import { TEAM_COLORS } from '@faf/modelkit/materials';

export type Cleanup = () => void;

export function markReady(): void {
  document.documentElement.dataset['ready'] = '1';
}

export function showError(app: HTMLElement, e: unknown): void {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  app.innerHTML = `<pre class="error">${esc(msg)}</pre>`;
  document.documentElement.dataset['error'] = msg.split('\n')[0] ?? 'error';
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html !== '') e.innerHTML = html;
  return e;
}

/** Team color by key (`blue`) or hex; default blue. */
export function teamHex(key: string | null | undefined): string {
  if (key === null || key === undefined || key === '') return '#2F6FD0';
  if (/^#?[0-9a-fA-F]{6}$/.test(key)) return key.startsWith('#') ? key : `#${key}`;
  return TEAM_COLORS.find((t) => t.key === key)?.hex ?? '#2F6FD0';
}

export { TEAM_COLORS };

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
