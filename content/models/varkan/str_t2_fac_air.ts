/**
 * Luftwerk II (core:str_t2_fac_air) – Varkan-Luftfabrik T2 (In-Place-Upgrade von Luftwerk I).
 *
 * Roster: „Luftwerk ×1,3 mit Schlot, 2 Tech-Streifen.“ Grundform aus str_t1_fac_land.ts (worksParts, Luft);
 * Upgrade wächst nur in der Höhe (Roster-Maßstab y 1,2), dazu ein Schlot auf der rechten Wand und 2 Streifen.
 */
import { defineModel } from "@faf/modelkit";
import { worksParts } from "./str_t1_fac_land.ts";

export default defineModel({
  id: "core:str_t2_fac_air",
  parts: worksParts(2, "air"),
  notes: "v_fac_air T2.",
});
