/**
 * Landwerk II (core:str_t2_fac_land) – Varkan-Landfabrik T2 (In-Place-Upgrade von Landwerk I).
 *
 * Roster: „Landwerk ×1,3 mit Schlot, 2 Tech-Streifen.“ Grundform aus str_t1_fac_land.ts; Upgrades wachsen nur in der Höhe (Roster-Maßstab y 1,2),
 * dazu ein Schlot auf der rechten Wand und 2 Streifen.
 */
import { defineModel } from "@faf/modelkit";
import { worksParts } from "./str_t1_fac_land.ts";

export default defineModel({
  id: "core:str_t2_fac_land",
  parts: worksParts(2, "land"),
  notes: "v_fac_land T2.",
});
