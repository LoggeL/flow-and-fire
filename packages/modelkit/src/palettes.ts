/**
 * Faction palettes (material tables of docs/design/faction.md §4.1 and docs/design/factions/f2–f4/faction.md §4.1).
 * `content/models/<slug>/_faction.ts` uses them as the faction default; a model file can pick another one by name
 * (`defineModel({ palette: 'sael', … })`) or pass its own `definePalette({...})`.
 *
 * Slot meaning is the same in every faction (0 body, 1 team, 2 accent/metal, 3 glow, 4 class marker), so all
 * factions share one shader path. Colors are sRGB hex; `team` is light neutral (tinted in the shader).
 */
import { DEFAULT_PALETTE, definePalette, type Palette } from './materials.ts';

/** Varkan „Gießerei“: cast-iron graphite, copper, ember glow, ceramic class marker. */
export const VARKAN_PALETTE = definePalette({
  faction: 'varkan',
  slots: {
    base: { color: '#2E2B29' }, // Gusseisen (Graphit), Roughness 0,85
    dark: { color: '#1E1C1B' }, // Unterseiten, Fahrwerk, Rohre
    metal: { color: '#B06A3B', metal: 0.8 }, // Kupfer
    team: { color: '#FFFFFF' }, // lackierte Bannerplatte (× Teamfarbe im Shader)
    glow: { color: '#FF9A3C' }, // Glut (Kern #FFD9A0, Falloff #FF8A2A), emissive
    glass: { color: '#3B4A4F' }, // Sichtschlitze (selten)
    accent: { color: '#CFC6B4' }, // Keramik-Hitzeschild: Tech-Streifen, Engineer-Deck
  },
  aliases: { body: 'base', iron: 'base', soot: 'dark', copper: 'metal', ceramic: 'accent' },
  teamAlt: [{ slot: 'glow', teams: ['red', 'orange'], color: '#FFE9C0' }], // Weißglut
});

/**
 * Skarn „Kluftwuchs“ (f2 §4.1): glossy black chitin (flat shading, sharp glossy edges), dark-red sinew and garnet
 * glass, garnet glow only on flow units, quartz as class marker (tech stripes, engineer deck, commander feelers).
 */
export const SKARN_PALETTE = definePalette({
  faction: 'skarn',
  slots: {
    base: { color: '#18171C', metal: 0.25 }, // Schwarzchitin mit Violettstich, glänzend (Roughness 0,3)
    dark: { color: '#0E0D11' }, // Unterseiten, Beine
    metal: { color: '#6E1A22', metal: 0.2 }, // Sehne (Glanzkanten #A8303C), 6–10 %
    team: { color: '#FFFFFF' }, // Rückenplatte
    glow: { color: '#FF5A74' }, // Granatglut-Herzkern (Kern #FFB0BE, Falloff #E0203F), nur Flow-Einheiten
    glass: { color: '#3A0F18', metal: 0.5 }, // Granatlinse im Leerlauf: dunkles, glänzendes Glas
    accent: { color: '#D6D3DC' }, // Quarz: Tech-Streifen, Engineer-Deck, Taster des Rädelsführers
    accent2: { color: '#3A3634' }, // Krustengrau: Gebäudekruste, Staub
    glow2: { color: '#E0203F', glow: 0.5 }, // Nervennaht (≤ 2 %): Gelenke, Sehnenansätze
  },
  aliases: { body: 'base', chitin: 'base', underside: 'dark', sinew: 'metal', garnet: 'glass', lens: 'glass', quartz: 'accent', crust: 'accent2', nerve: 'glow2' },
  teamAlt: [
    { slot: 'glow', teams: ['red', 'pink'], color: '#FFE0E8' }, // Rosaquarz-Weiß
    { slot: 'glow2', teams: ['red', 'pink'], color: '#FFE0E8' },
  ],
});

/**
 * Sael „Schichtung“ (f3 §4.1): light nacre on top, dark shell rind below, gold only as edges (engineers/prior up to
 * 20 %), deep-jade lacquer (tech stripes, hover-pad underside), gold-core light on flow units, jade light seams.
 */
export const SAEL_PALETTE = definePalette({
  faction: 'sael',
  slots: {
    base: { color: '#E4DED2' }, // Perlmutt (oben), Roughness 0,35
    dark: { color: '#26302C' }, // Schalenrinde (Unterseiten), Schwebeteller
    metal: { color: '#C8A24A', metal: 0.9 }, // Gold: Kanten, Lanzenschaft, Sichel, Engineer-Deck
    team: { color: '#FFFFFF' }, // Emaille-Einlage
    glow: { color: '#F6CF6A' }, // Goldkern (Kern #FFF3CF, Falloff #F2C45A), nur Flow-Einheiten
    glass: { color: '#A9C7BE', metal: 0.2 }, // Laternenglas, Perlglas-Fenster
    accent: { color: '#1E4A40' }, // Tiefjade-Lack: Tech-Streifen, Teller-Unterseite
    accent2: { color: '#F5F1E8' }, // Perlglanz (Schalenscheitel, oberste 15 %)
    glow2: { color: '#7FE3C0', glow: 0.5 }, // Lichtnaht Jade (≤ 2 %)
  },
  aliases: { body: 'base', nacre: 'base', rind: 'dark', gold: 'metal', enamel: 'team', light: 'glow', jade: 'accent', lustre: 'accent2', seam: 'glow2' },
  teamAlt: [
    { slot: 'glow', teams: ['orange', 'olive'], color: '#F6F3FF' }, // Goldkern → Weißlicht
    { slot: 'glow2', teams: ['green', 'cyan'], color: '#DCE6EE' }, // Jade → Silberlicht
  ],
});

/**
 * Aurith „Gesungenes Glas“ (f4 §4.1): dark pitch-glass core, large amber-glass shells (25–35 %), phase-blue light
 * (resonance crystals on flow units, glyph bands everywhere), ice-white pearl glass as class marker.
 */
export const AURITH_PALETTE = definePalette({
  faction: 'aurith',
  slots: {
    base: { color: '#1F1B22', metal: 0.15 }, // Pechglas: Kern, Kiel-Unterseite, Beine
    dark: { color: '#141117' }, // Unterseiten
    metal: { color: '#C8912E', metal: 0.35 }, // Bernsteinglas-Schalen (Grund)
    team: { color: '#FFFFFF' }, // Kamm und Glyphenfelder
    glow: { color: '#8AD8FF' }, // Resonanzkern (Kern #BFF2FF, Falloff #3FA9FF), nur Flow-Einheiten
    glass: { color: '#8A5A18', metal: 0.3 }, // Bernstein-Tiefe
    accent: { color: '#D5DCE2' }, // Perlglas: Tonpunkte, Engineer-Rücken, Sichel
    accent2: { color: '#E8C070', metal: 0.3 }, // Bernstein-Kante
    glow2: { color: '#3FA9FF', glow: 0.6 }, // Glyphenband (≤ 3 %)
  },
  aliases: { body: 'base', pitch: 'base', amber: 'metal', amberdeep: 'glass', pearl: 'accent', amberedge: 'accent2', phase: 'glow', glyph: 'glow2' },
  teamAlt: [
    { slot: 'glow', teams: ['blue', 'cyan'], color: '#EAF7FF' }, // Phase → Weißphase
    { slot: 'glow2', teams: ['blue', 'cyan'], color: '#EAF7FF' },
    { slot: 'metal', teams: ['orange', 'olive'], color: '#8A8174' }, // Schalen → Rauchquarz
  ],
});

/** Palettes by name (faction slug); `default` = neutral fallback. */
export const PALETTES: Readonly<Record<string, Palette>> = {
  default: DEFAULT_PALETTE,
  varkan: VARKAN_PALETTE,
  skarn: SKARN_PALETTE,
  sael: SAEL_PALETTE,
  aurith: AURITH_PALETTE,
};

export function paletteByName(name: string): Palette {
  const p = PALETTES[name];
  if (p === undefined) throw new Error(`unknown palette "${name}" (${Object.keys(PALETTES).join(', ')})`);
  return p;
}
