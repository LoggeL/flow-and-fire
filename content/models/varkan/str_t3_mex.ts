/**
 * Zapfstelle III (core:str_t3_mex) – Varkan-Massenextraktor T3 (In-Place-Upgrade der Zapfstelle II).
 *
 * Roster: „Zapfstelle auf 2×2 (Höhe ×1,4), doppelter Kranz, 3 Tech-Streifen; kein Heckschlot (unterscheidet sich so
 * von der Dampfquelle).“ Grundform aus str_t1_mex.ts; zweiter Kranz (Eisen), Schürzen, 3 Streifen.
 */
import { defineModel } from "@faf/modelkit";
import { mexParts } from "./str_t1_mex.ts";

export default defineModel({
  id: "core:str_t3_mex",
  parts: mexParts(3),
  notes: "v_mex T3: doppelter Kranz, Schürzen, 3 Streifen, kein Schlot.",
});
