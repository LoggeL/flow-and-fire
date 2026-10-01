/**
 * Hash routes of the gallery:
 *   #/                                  index (all components with their states)
 *   #/story/<id>?locale=de|en|pseudo&scale=<n>&teams=house|relation|cvd&motion=reduce&shot=1
 *   #/matrix/<component>?locale=…&teams=…   all stories of a component side by side (iframes)
 */
export type GalleryLocale = 'de' | 'en' | 'pseudo';
export type GalleryTeams = 'house' | 'relation' | 'cvd';

export interface GalleryParams {
  readonly locale?: GalleryLocale;
  readonly scale?: number;
  readonly teams?: GalleryTeams;
  readonly motion?: 'reduce';
  /** Screenshot mode: no gallery chrome, story box at 0,0. */
  readonly shot: boolean;
}

export type Route =
  | { readonly kind: 'index'; readonly params: GalleryParams }
  | { readonly kind: 'story'; readonly id: string; readonly params: GalleryParams }
  | { readonly kind: 'matrix'; readonly component: string; readonly params: GalleryParams }
  | { readonly kind: 'unknown'; readonly path: string; readonly params: GalleryParams };

const LOCALES: readonly string[] = ['de', 'en', 'pseudo'];
const TEAMS: readonly string[] = ['house', 'relation', 'cvd'];

export function parseParams(query: string): GalleryParams {
  const q = new URLSearchParams(query);
  const out: { -readonly [K in keyof GalleryParams]: GalleryParams[K] } = { shot: q.get('shot') === '1' };
  const locale = q.get('locale');
  if (locale !== null && LOCALES.includes(locale)) out.locale = locale as GalleryLocale;
  const scale = q.get('scale');
  if (scale !== null) {
    const n = Number(scale);
    if (Number.isFinite(n) && n >= 0.5 && n <= 2) out.scale = n;
  }
  const teams = q.get('teams');
  if (teams !== null && TEAMS.includes(teams)) out.teams = teams as GalleryTeams;
  if (q.get('motion') === 'reduce') out.motion = 'reduce';
  return out;
}

/** Parses `location.hash` (with or without the leading '#'). */
export function parseRoute(hash: string): Route {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  const qi = h.indexOf('?');
  const path = qi < 0 ? h : h.slice(0, qi);
  const params = parseParams(qi < 0 ? '' : h.slice(qi + 1));
  const parts = path.split('/').filter((p) => p !== '');
  if (parts.length === 0) return { kind: 'index', params };
  if (parts[0] === 'story' && parts.length === 2) return { kind: 'story', id: decodeURIComponent(parts[1]!), params };
  if (parts[0] === 'matrix' && parts.length === 2) return { kind: 'matrix', component: decodeURIComponent(parts[1]!), params };
  return { kind: 'unknown', path, params };
}

export function formatParams(p: Partial<GalleryParams>): string {
  const q = new URLSearchParams();
  if (p.locale !== undefined) q.set('locale', p.locale);
  if (p.scale !== undefined) q.set('scale', String(p.scale));
  if (p.teams !== undefined) q.set('teams', p.teams);
  if (p.motion !== undefined) q.set('motion', p.motion);
  if (p.shot === true) q.set('shot', '1');
  const s = q.toString();
  return s === '' ? '' : `?${s}`;
}

export function storyHref(id: string, p: Partial<GalleryParams> = {}): string {
  return `#/story/${encodeURIComponent(id)}${formatParams(p)}`;
}

export function matrixHref(component: string, p: Partial<GalleryParams> = {}): string {
  return `#/matrix/${encodeURIComponent(component)}${formatParams(p)}`;
}
