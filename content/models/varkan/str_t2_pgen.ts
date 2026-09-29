/**
 * Glutkessel II (core:str_t2_pgen) – Varkan-Kraftwerk T2 (Neubau 6×6).
 *
 * Roster: „Kessel auf 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Schloten, 2 Tech-Streifen; füllt ≥ 70 % der
 * Footprint-Kante.“ Grundform aus str_t1_pgen.ts im Basismaß 2×2; Maßstab 3,0 / 3,6 aus dem Roster.
 */
import { defineModel } from "@faf/modelkit";
import { pgenParts } from "./str_t1_pgen.ts";

export default defineModel({
  id: "core:str_t2_pgen",
  parts: pgenParts(2),
  notes: "v_pgen T2: 2 Schlote, Front-Schürze, 2 Streifen.",
});
