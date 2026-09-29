/**
 * Glutkessel III (core:str_t3_pgen) – Varkan-Kraftwerk T3 (Neubau 8×8).
 *
 * Roster: „Kessel auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Schloten, 3 Tech-Streifen; füllt ≥ 70 % der
 * Footprint-Kante.“ Grundform aus str_t1_pgen.ts im Basismaß 2×2; Maßstab 4,0 / 5,6 aus dem Roster.
 */
import { defineModel } from "@faf/modelkit";
import { pgenParts } from "./str_t1_pgen.ts";

export default defineModel({
  id: "core:str_t3_pgen",
  parts: pgenParts(3),
  notes: "v_pgen T3: 3 Schlote, Schürzen vorn/links/rechts, 3 Streifen.",
});
