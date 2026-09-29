/**
 * Geselle (core:lnd_t2_engineer) – Varkan-Engineer T2.
 *
 * Roster: „Wie Lehrling, Maßstab 1,3, zwei Kupfer-Kranarme verschiedener Länge, 2 Tech-Streifen graphit.“
 * Grundform aus lnd_t1_engineer.ts (Superset-Visual v_eng); der Maßstab 1,3 kommt aus dem Roster.
 * Parts: hull, boom (langer Arm, Yaw), boom2 (kurzer Arm rechts hinten, Yaw); Emitter statisch an den Armspitzen.
 */
import { defineModel } from "@faf/modelkit";
import { engineerParts } from "./lnd_t1_engineer.ts";

export default defineModel({
  id: "core:lnd_t2_engineer",
  parts: engineerParts(2),
  notes:
    "v_eng T2: zweiter, kurzer Kranarm; Emitter statisch (Anim-Limit 2 laut Roster).",
});
