/**
 * Varkan-Kompakt (Fraktion `core`): Designsprache „Gießerei“ (docs/design/faction.md §3–§4).
 * Gusseisen-Graphit, Bannerplatten in Teamfarbe, Kupferleitungen, Glutnähte, Keramik nur für Tech-Streifen und
 * Engineer-Decks.
 */
import { defineFaction, VARKAN_PALETTE } from '@faf/modelkit';

// Palette (Gusseisen #2E2B29, Kupfer, Glut #FF9A3C, Keramik; Aliase body/iron/soot/copper/ceramic) liegt im Kit:
// packages/modelkit/src/palettes.ts, damit Modelle sie auch per Name wählen können (`palette: 'varkan'`).
export default defineFaction({
  slug: 'varkan',
  name: 'Varkan',
  roster: 'docs/design/roster.json',
  palette: VARKAN_PALETTE,
});
