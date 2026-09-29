/**
 * Luftwerk I (core:str_t1_fac_air) – Varkan-Luftfabrik T1 auf 8×8.
 *
 * Roster: „U-Portal mit Landescheibe statt Rampe.“ Gleiches Portal wie das Landwerk (worksParts aus
 * str_t1_fac_land.ts), vorn statt der Rampe eine runde Landescheibe mit dunkler Mitte und vier Glut-Landefeuern.
 */
import { defineModel } from "@faf/modelkit";
import { worksParts } from "./str_t1_fac_land.ts";

export default defineModel({
  id: "core:str_t1_fac_air",
  parts: worksParts(1, "air"),
  notes: "v_fac_air T1: Landescheibe statt Rampe.",
});
