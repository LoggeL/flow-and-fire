/**
 * Landwerk III (core:str_t3_fac_land) – Varkan-Landfabrik T3 (In-Place-Upgrade von Landwerk II).
 *
 * Roster: „Landwerk ×1,7 mit zwei Schloten und Schürze, 3 Tech-Streifen (9 Parts = Struktur-Maximum).“ Grundform aus str_t1_fac_land.ts; Upgrades wachsen nur in der Höhe (Roster-Maßstab y 1,4),
 * dazu zwei Schlote, Schürzen außen an den Wänden und 3 Streifen.
 */
import { defineModel } from "@faf/modelkit";
import { worksParts } from "./str_t1_fac_land.ts";

export default defineModel({
  id: "core:str_t3_fac_land",
  parts: worksParts(3, "land"),
  notes: "v_fac_land T3.",
});
