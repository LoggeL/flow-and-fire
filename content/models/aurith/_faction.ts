/**
 * Aurith-Chor (Fraktion `f4`): Designsprache „Gesungenes Glas“ (docs/design/factions/f4/faction.md §3–§4).
 * Pechglas-Kern, Bernsteinglas-Schalen (weiche Normalen), teamfarbener Kamm, phasenblaue Glyphenbänder (`glow2`),
 * Resonanzkristalle nur bei Flow-Einheiten, Perlglas als Klassenkennung. Kurve = Körper, Gerade = Waffe;
 * Gleiter schweben mit GLIDE_HEIGHT über dem Boden.
 */
import { AURITH_PALETTE, defineFaction } from '@faf/modelkit';

export default defineFaction({
  slug: 'aurith',
  name: 'Aurith',
  roster: 'docs/design/factions/f4/roster.json',
  palette: AURITH_PALETTE,
});
