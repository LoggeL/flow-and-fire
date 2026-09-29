/**
 * Meister (core:lnd_t3_engineer) – Varkan-Engineer T3.
 *
 * Roster: „Maßstab 1,4 (Deckel für 1×1-Footprint), drei Kupfer-Kranarme (Anzahl = Tech), 3 Tech-Streifen graphit;
 * dritter Arm statisch (Anim-Limit 2).“
 * Grundform aus lnd_t1_engineer.ts (Superset-Visual v_eng); Maßstab 1,4 aus dem Roster.
 * Parts: hull (inkl. drittem, statischem Arm vorn links), boom (Yaw), boom2 (Yaw).
 */
import { defineModel } from "@faf/modelkit";
import { engineerParts } from "./lnd_t1_engineer.ts";

export default defineModel({
  id: "core:lnd_t3_engineer",
  parts: engineerParts(3),
  notes: "v_eng T3: drei Arme, der dritte statisch im Rumpf.",
});
