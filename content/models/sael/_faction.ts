/**
 * Orden von Sael (Fraktion `f3`): Designsprache „Schichtung“ (docs/design/factions/f3/faction.md §3–§4).
 * Glatte Perlmutt-Schalen (weiche Normalen, `smooth`), Emaille-Einlagen in Teamfarbe, Gold nur als Kante, Tiefjade
 * für Tech-Streifen und Tellerunterseiten, Goldkern-Licht nur bei Flow-Einheiten, Jade-Lichtnähte. Schweber tragen
 * den dunklen Schwebeteller; die Schwebehöhe kommt aus dem Roster (`hover`, Kit-Konvention HOVER_HEIGHT).
 */
import { defineFaction, SAEL_PALETTE } from '@faf/modelkit';

export default defineFaction({
  slug: 'sael',
  name: 'Sael',
  roster: 'docs/design/factions/f3/roster.json',
  palette: SAEL_PALETTE,
});
