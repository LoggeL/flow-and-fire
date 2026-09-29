/**
 * Zapfstelle II (core:str_t2_mex) – Varkan-Massenextraktor T2 (In-Place-Upgrade der Zapfstelle I).
 *
 * Roster: „Zapfstelle auf 2×2 (Höhe ×1,2) mit Schürzenplatten, 2 Tech-Streifen.“ Grundform aus str_t1_mex.ts;
 * Höhe ×1,2 kommt aus dem Roster-Maßstab, dazu Schürzenplatten links/rechts und ein höherer Pumpenkopf.
 */
import { defineModel } from "@faf/modelkit";
import { mexParts } from "./str_t1_mex.ts";

export default defineModel({
  id: "core:str_t2_mex",
  parts: mexParts(2),
  notes: "v_mex T2: Schürzenplatten, 2 Streifen.",
});
