/**
 * Skarn-Geflecht (Fraktion `f2`): Designsprache „Kluftwuchs“ (docs/design/factions/f2/faction.md §3–§4).
 * Glänzendes Schwarzchitin (Flat Shading, scharfe Glanzkanten), teamfarbene Rückenplatten, Sehnen und Granatglas,
 * Granatglut nur bei Flow-Einheiten, Quarz als Klassenkennung. Alles auf Knickbeinen, streng eckig, keine Kurven.
 */
import { defineFaction, SKARN_PALETTE } from '@faf/modelkit';

export default defineFaction({
  slug: 'skarn',
  name: 'Skarn',
  roster: 'docs/design/factions/f2/roster.json',
  palette: SKARN_PALETTE,
  // Plagen (T4): Vorschlag experimentals.md §2.4 statt des Kit-Standards T4_BUDGET 1.600 / 800 / 320
  budgets: { t4: { tris: [1200, 700, 350] } },
});
