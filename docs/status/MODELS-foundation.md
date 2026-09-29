# MODELS-foundation – Fundament für Einheiten-Modelle

**Stand 2026-09-29.** Branch `models`. Kein Eingriff in `packages/render`, `packages/sim`, `packages/client`.

## Umgesetzt

| Teil | Ort | Inhalt |
|---|---|---|
| Kitbash-DSL | `packages/modelkit` (`@faf/modelkit`, reines TS, nur `@gltf-transform/core`) | 14 Primitive (box, beveledBox, wedge, prism, cylinder, frustum, cone, sphere/hemi, icosphere, capsule, torus, tube/Schale, extrude, loft, quad), Transform, mirrorX/flipX, array/radial, stripes; Parts mit Pivot/Parent/Anim (hull + ≤ 8); Materialslots base/dark/metal/team/glow/glass/accent + Fraktions-Aliase → `COLOR_0` + `_MASK`; Flat Shading; Auto-LODs (Kleinteile, Segmente, Fasen, Profil-Vereinfachung, `keep`/`minLod`/`maxLod`); Budgets je Klasse; Footprint-Check; Team-Anteil der Draufsicht (Z-Buffer); GLB-Export byte-deterministisch; Metadaten-JSON |
| Modelle + Registry + CLI | `content/models/<fraktion>/<unit>.ts`, `content/models/registry.ts`, `pnpm models` | Auto-Discovery, `_faction.ts` (Palette, Roster-Pfad), Roster-Vorgaben (Name, Klasse, Footprint, Maßstab, Icon), Ausgabe `content/models/dist/*.glb|json` + `manifest.json` |
| Referenzmodell | `content/models/varkan/lnd_t1_tank.ts` | Punze: 316 / 218 / 98 Tris, 3 Parts (hull, turret yaw, barrel pitch), Team-Draufsicht 39 %, Kupfer 12 %, Glut 0,2 % |
| Icons | `content/icons/grammar.ts`, `build.ts`, `svg/`, `icons.json` | 7 Grundformen, 19 Glyphen, Kerben 1–3, selected/blip/ghost; alle 50 Roster-Icons |
| Viewer | `apps/model-viewer` (Vite + three.js), `pnpm models:viewer` | Galerie, Einzelansicht (Drehteller, 8 Teamfarben, Farbe/Grau/Silhouette, Parts-Animation, Drahtgitter, Distanz-Slider Spielkamera 50° mit LOD-Wechsel und Icon unter `iconThreshold`), Größenvergleich (mehrere Fraktionen), Icon-Übersicht, Render-Routen für Screenshots |
| Screenshots | `tools/model-shots`, `pnpm models:shots` | Kontaktabzug, Silhouetten (+ 32/48 px), Größenvergleich, Einzelbilder, Icon-Übersicht nach `/private/tmp/claude-501/faf-models/`; eigener Vite-Server auf freiem Port |
| Tests | `packages/modelkit/test` (87) | Geschlossenheit/Orientierung/Volumen aller Primitive in LOD0–2, Flat Shading, Parts, Masken, Spiegelung, LOD-Regeln, Fehlerfälle, Footprint, GLB-Inhalt + Determinismus, Vertragstest für alle Content-Modelle, Icon-Grammatik |

## Verträge für Folgepakete

- Modellraum: 1 = 1 WU, Ursprung Footprint-Mitte am Boden, **+Z vorne**, +Y oben (glTF). Render-Integration dreht
  um −90° (Yaw 0 = +X) und liest `_PARTID`/Parts wie die Pipeline-GLBs (`extras.faf.parts`, Part 0 = hull).
- Neue Modelle: nur Dateien unter `content/models/<fraktion>/` anlegen – keine Registry-Änderung nötig; der
  Vertragstest prüft sie automatisch. Anleitung: `content/models/README.md`.
- Roster anderer Fraktionen unter `docs/design/factions/<slug>/roster.json` (Format `faf-roster/1`).

## Abweichungen / Grenzen

- LOD1/LOD2-Budgets (220/110) sind eigene Festlegung; PLAN/Roster nennen nur LOD0 ≤ 350.
- Superset-Visuals mit Tech-Bitmaske (faction.md §3.3) sind noch nicht umgesetzt: ein Modell pro Blueprint.
- Tech-Streifen sind Decal-Quads (Geometrie), nicht Masken; `_MASK.a` ist AO aus der Normalen, kein Ruß-Gradient.
- Icons als SVG; der MSDF-Atlas folgt in der Asset-Pipeline.
- Playwright-Browser-Cache war leer; `pnpm exec playwright install chromium` wurde nachgeholt.
