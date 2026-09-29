/** Gallery: all models per faction as a grid (thumbnail, name, id, tris per LOD, budget / footprint state). */
import type { ModelMeta } from '@faf/modelkit';
import { loadManifest } from '../models.ts';
import { thumbnail } from '../thumbs.ts';
import { el, esc, markReady, type Cleanup } from '../util.ts';

function badges(m: ModelMeta): string {
  const out: string[] = [];
  out.push(m.budget.ok ? '<span class="badge ok">Budget ok</span>' : '<span class="badge err">Budget</span>');
  if (!m.footprintCheck.ok) out.push('<span class="badge warn">Footprint</span>');
  if (m.warnings.length > 0) out.push(`<span class="badge warn" title="${esc(m.warnings.join('\n'))}">${m.warnings.length} Hinweis(e)</span>`);
  return out.join('');
}

export async function mountGallery(app: HTMLElement, faction: string | null): Promise<Cleanup> {
  const manifest = await loadManifest();
  let alive = true;
  const tabs = el('div', { class: 'tabs' });
  tabs.innerHTML =
    `<a href="#/" class="${faction === null ? 'active' : ''}">Alle (${manifest.models.length})</a>` +
    manifest.factions
      .map((f) => `<a href="#/f/${f.slug}" class="${f.slug === faction ? 'active' : ''}">${esc(f.name)} (${f.models.length})</a>`)
      .join('') +
    manifest.factions.map((f) => `<a href="#/sheet/${f.slug}">Kontaktabzug ${esc(f.name)}</a><a href="#/sheet/${f.slug}?mode=silhouette">Silhouetten ${esc(f.name)}</a>`).join('');
  app.append(tabs);
  const factions = manifest.factions.filter((f) => faction === null || f.slug === faction);
  if (factions.length === 0) app.append(el('p', {}, `Keine Modelle für „${esc(faction ?? '')}“.`));
  const jobs: { img: HTMLImageElement; meta: ModelMeta }[] = [];
  for (const f of factions) {
    app.append(el('h2', {}, `${esc(f.name)} <span class="small">${f.models.length} Modelle</span>`));
    const grid = el('div', { class: 'grid' });
    const metas = manifest.models.filter((m) => m.faction === f.slug);
    for (const m of metas) {
      const card = el('a', { class: 'card', href: `#/model/${m.faction}/${m.unit}` });
      const img = el('img', { alt: m.name });
      card.append(img);
      card.append(
        el(
          'div',
          { class: 'meta' },
          `<div class="name">${esc(m.name)} <span class="small">${esc(m.role)}</span></div>` +
            `<div class="id">${esc(m.id)}</div>` +
            `<div class="small">Tris ${m.lods.map((l) => l.triangles).join(' / ')} · T${m.tech} · ${m.footprint.join('×')}</div>` +
            `<div>${badges(m)}</div>`,
        ),
      );
      grid.append(card);
      jobs.push({ img, meta: m });
    }
    app.append(grid);
  }
  for (const j of jobs) {
    if (!alive) break;
    j.img.src = await thumbnail(j.meta);
  }
  markReady();
  return () => {
    alive = false;
  };
}
