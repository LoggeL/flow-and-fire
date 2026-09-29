/**
 * FAF model viewer (tool, three.js allowed). Hash routes:
 *   #/                         gallery (all factions)      #/f/<faction>             gallery of one faction
 *   #/model/<faction>/<unit>   single view                 #/compare?f=a,b           size comparison
 *   #/icons                    icon grammar overview
 *   #/sheet/<faction>?mode=color|silhouette&team=blue     contact sheet (tools/model-shots)
 *   #/shot/<faction>/<unit>?mode=color|silhouette&team=…  single picture (tools/model-shots)
 * `?chrome=0` hides the header. When a route has finished rendering, <html data-ready="1"> is set.
 */
import { mountCompare } from './views/compare.ts';
import { mountGallery } from './views/gallery.ts';
import { mountIcons } from './views/icons.ts';
import { mountSheet, mountShot } from './views/sheet.ts';
import { mountSingle } from './views/single.ts';
import { showError, type Cleanup } from './util.ts';

interface Route {
  readonly path: string[];
  readonly query: URLSearchParams;
}

function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p = '', q = ''] = raw.split('?');
  return { path: p.split('/').filter((s) => s !== '').map(decodeURIComponent), query: new URLSearchParams(q) };
}

const app = document.getElementById('app')!;
const nav = document.getElementById('nav')!;
let cleanup: Cleanup | null = null;

function renderNav(active: string): void {
  const links: [string, string][] = [
    ['gallery', '#/'],
    ['compare', '#/compare'],
    ['icons', '#/icons'],
  ];
  const label: Record<string, string> = { gallery: 'Galerie', compare: 'Größenvergleich', icons: 'Strategic Icons' };
  nav.innerHTML = links.map(([k, href]) => `<a href="${href}" class="${k === active ? 'active' : ''}">${label[k]}</a>`).join('');
}

async function route(): Promise<void> {
  cleanup?.();
  cleanup = null;
  delete document.documentElement.dataset['ready'];
  app.innerHTML = '';
  const r = parseHash();
  const top = document.getElementById('top')!;
  top.style.display = r.query.get('chrome') === '0' ? 'none' : '';
  const [head = '', a, b] = r.path;
  try {
    switch (head) {
      case '':
      case 'f':
        renderNav('gallery');
        cleanup = await mountGallery(app, a ?? null);
        break;
      case 'model':
        renderNav('gallery');
        cleanup = await mountSingle(app, a ?? '', b ?? '');
        break;
      case 'compare':
        renderNav('compare');
        cleanup = await mountCompare(app, r.query);
        break;
      case 'icons':
        renderNav('icons');
        cleanup = await mountIcons(app, r.query);
        break;
      case 'sheet':
        renderNav('');
        cleanup = await mountSheet(app, a ?? '', r.query);
        break;
      case 'shot':
        renderNav('');
        cleanup = await mountShot(app, a ?? '', b ?? '', r.query);
        break;
      default:
        app.textContent = `Unbekannte Route ${location.hash}`;
    }
  } catch (e) {
    showError(app, e);
  }
}

window.addEventListener('hashchange', () => void route());
void route();
