/**
 * Varkan-Kompakt (Fraktion `core`): Designsprache „Gießerei“ (docs/design/faction.md §3–§4).
 * Gusseisen-Graphit, Bannerplatten in Teamfarbe, Kupferleitungen, Glutnähte, Keramik nur für Tech-Streifen und
 * Engineer-Decks.
 */
import { defineFaction, definePalette } from '@faf/modelkit';

export default defineFaction({
  slug: 'varkan',
  name: 'Varkan',
  roster: 'docs/design/roster.json',
  palette: definePalette({
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
  }),
});
