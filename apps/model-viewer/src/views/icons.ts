/** Strategic icon grammar overview: base forms, glyphs, tech notches, states, and every roster icon. */
import {
  blipSvg,
  FORMS,
  formSvg,
  GLYPHS,
  glyphSvg,
  iconScale,
  iconSvg,
  notchSvg,
  parseIconId,
  type IconForm,
} from '../../../../content/icons/grammar.ts';
import { el, esc, markReady, TEAM_COLORS, teamHex, type Cleanup } from '../util.ts';

interface IconIndex {
  readonly icons: readonly { id: string; units: string[]; scale: number }[];
}

function cell(svg: string, label: string, sub = ''): string {
  return `<div class="icon-cell">${svg}<div>${esc(label)}</div>${sub === '' ? '' : `<div class="small">${esc(sub)}</div>`}</div>`;
}

export async function mountIcons(app: HTMLElement, query: URLSearchParams): Promise<Cleanup> {
  const team = teamHex(query.get('team'));
  let index: IconIndex = { icons: [] };
  try {
    const r = await fetch('/icons/icons.json');
    if (r.ok) index = (await r.json()) as IconIndex;
  } catch {
    // no index yet: sections from the grammar only
  }
  const tabs = el('div', { class: 'tabs' });
  tabs.innerHTML = TEAM_COLORS.map((t) => `<a href="#/icons?team=${t.key}" class="${t.hex === team ? 'active' : ''}" style="border-color:${t.hex}">${t.de}</a>`).join('');
  app.append(tabs);
  app.style.setProperty('--team', team);
  const big = 72;

  app.append(el('h2', {}, 'Grundformen (Domäne)'));
  app.append(el('div', { class: 'icon-sheet' }, (Object.keys(FORMS) as IconForm[]).map((f) => cell(formSvg(f, { team, size: big }), f, FORMS[f].label)).join('')));

  app.append(el('h2', {}, 'Glyphen (Rolle)'));
  app.append(el('div', { class: 'icon-sheet' }, Object.keys(GLYPHS).map((g) => cell(glyphSvg(g, { size: big }), g, GLYPHS[g]!.label)).join('')));

  app.append(el('h2', {}, 'Tech-Kerben und Zustände'));
  const sample = 'land_direct_t2';
  const struct = 'struct_direct_t1';
  app.append(
    el(
      'div',
      { class: 'icon-sheet' },
      [
        ...([1, 2, 3] as const).map((n) => cell(notchSvg(n, { size: big }), `T${n}`, 'Kerben 5×9 DE')),
        cell(iconSvg(sample, { team, size: big }), 'normal', sample),
        cell(iconSvg(sample, { team, size: big, variant: 'selected' }), 'ausgewählt', 'weißer Außenring'),
        cell(blipSvg('ground', { size: big }), 'Radar-Blip Boden', 'Achteck, neutral'),
        cell(blipSvg('air', { size: big }), 'Radar-Blip Luft', 'Dreieck'),
        cell(blipSvg('struct', { size: big }), 'Radar-Blip Gebäude', 'Sechseck'),
        cell(iconSvg(struct, { team, size: big, variant: 'ghost' }), 'Ghost', 'Sechseck 48 %, gestrichelt'),
      ].join(''),
    ),
  );

  app.append(el('h2', {}, `Alle Roster-Icons (${index.icons.length}) – Echtgröße 20 px × Faktor, 1× und 2×`));
  const cells = index.icons.map((i) => {
    const p = parseIconId(i.id);
    const px = Math.round(20 * iconScale(p));
    const real = `<div class="real">${iconSvg(i.id, { team, size: px })}${iconSvg(i.id, { team, size: px * 2 })}</div>`;
    return `<div class="icon-cell">${real}${iconSvg(i.id, { team, size: big })}<div>${esc(i.id)}</div><div class="small">${esc(i.units.join(', '))}</div></div>`;
  });
  app.append(el('div', { class: 'icon-sheet' }, cells.join('')));
  markReady();
  return () => {
    app.style.removeProperty('--team');
  };
}
