# TRACK-EDITOR · P0 – Prop-Felder im Kartenformat (PFLD)

Stand: 2026-09-29 · Worktree `faf-editor`, Branch `track-editor` · Paket `@faf/formats` (nur additiv)

## Umfang

Das Kartenformat `.rtsmap` hat jetzt einen optionalen Chunk **`PFLD`** für Prop-Felder: Flächen (Kreis oder
Polygon), die das Prop-System (E8/MS8) deterministisch mit Bäumen, Felsen oder Wracks füllt. Ein Feld wird
über Dichte, Seed, Skalierungsbereich, Neigungs- und Wassergrenze sowie den Reclaim-Wert je Prop beschrieben.
Die öffentliche API entspricht exakt der Vorgabe (`propfields.ts`, exportiert über `src/index.ts`):

- Typen: `PropFieldKind`, `MapPoint`, `PropFieldShape`, `PropFieldEntry`, `MapPropField`, `ExpandedProp`
- Konstanten: `MAP_MAX_PROP_FIELDS` 256, `MAP_MAX_FIELD_POINTS` 64, `MAP_MAX_FIELD_ENTRIES` 16,
  `MAP_MAX_FIELD_DENSITY` 4096, `MAP_MAX_FIELD_NAME_BYTES` 64, `PROPFIELD_ALGO_VERSION` 1
- Funktionen: `encodePropFieldsChunk`, `decodePropFieldsChunk`, `validatePropFields`, `propFieldBounds`,
  `propFieldContains`, `expandPropField`, `expandPropFields`, `propFieldsSimBytes`
- Zusätzlich exportiert (siehe Abweichungen): `MAP_MAX_FIELD_CELLS` (2^21), `propFieldCellRaw(density)` und
  `PropFieldMapView` (der strukturelle Kartentyp, den Validierung und Expansion lesen; `RtsMap` erfüllt ihn)

### Binärlayout PFLD (LE, pad4 relativ zum Payload-Anfang)

`u32 fieldCount` · je Feld: `u16 nameLen | name | pad4 | u8 kind | u8 shapeKind | u16 flags (bit0 dryOnly) |
u32 seed | u16 density | u16 maxSlope | u16 scaleMin | u16 scaleMax | u32 reclaimMassMilli |
u32 reclaimEnergyMilli | u16 entryCount | u16 pointCount` · Einträge `u16 idLen | id | pad4 | u16 weight |
u16 reserved` · Form: Kreis `i32 x, z, r` bzw. Polygon `pointCount × (i32 x, i32 z)`.
Der Leser prüft Längen (`bad-length`), Padding (`bad-padding`), reservierte Bits/Felder (`bad-reserved`) und
Enums/Anzahlen (`bad-value`). Dokumentiert in den Modul-Headern von `propfields.ts` und `rtsmap.ts`.

### Integration in `.rtsmap` (additiv)

- `RTSMAP_CHUNK_ORDER = ['META','HGT ','SPLT','PROP','PFLD','PREV']`.
- `RtsMap.propFields?` ist optional: Fehlt der Chunk, fehlt die Eigenschaft (auch nicht `undefined`).
  Ist er vorhanden, gibt es ein Array (auch leer). `writeRtsMap` schreibt PFLD genau dann, wenn
  `propFields !== undefined`. `createRtsMap` nimmt optional `propFields` an.
- `validateRtsMap` ruft `validatePropFields` auf. Geprüft werden alle Feld-Invarianten (Name 1..64 Bytes ohne
  Steuerzeichen; Kind; Kreis mit Mittelpunkt in der Karte und `r ∈ [4096, sizeWu·4096]`; Polygon mit
  3..64 Punkten in der Karte, ohne doppelte Nachbarpunkte, Fläche ≠ 0 und einfach, also ohne Kreuzung,
  Berührung oder Rückfaltung; 1..16 Einträge mit `PROP_ID_RE` und Gewicht 1..65535; Dichte 1..4096;
  Seed u32; Skalierung 1..65535 mit min ≤ max; maxSlope u16; dryOnly bool; Reclaim u32). Außerdem gilt
  `props.length + Expansionsanzahl ≤ MAP_MAX_PROPS` (Zählung ohne Allokation, bricht bei Überschreitung ab).
- Unbekannte Chunks behalten ihre Anker-Semantik. Ein Anker `'PFLD'` fällt ohne PFLD auf PROP zurück.
- META/MapMeta sind unverändert. `mapSimData` ist ebenfalls unverändert: Die Anbindung an die Sim folgt in MS8/E8.

### mapSimHash

`mapSimBytes` hängt nur bei vorhandenen **und** nicht leeren Feldern `'PFLD' | u32 PROPFIELD_ALGO_VERSION |
propFieldsSimBytes` an (PFLD-Layout mit nameLen 0, ohne Namen). Ohne Felder oder mit `[]` bleiben die Bytes
exakt wie bisher. Der Name hat keinen Einfluss auf den Hash, jeder andere Parameter und die Feldreihenfolge
schon (per Test gezeigt).

### Expansion (Algo v1, nur Integer)

`cellRaw = isqrt(floor(2^34 / density))` auf einem globalen Gitter ab (0,0). Besucht werden Zellen, deren
Rechteck die auf die Karte geklemmte Bounding-Box schneidet, zeilenweise (erst z, dann x). Pro Zelle gilt
`h1/h2 = rng32(seed, cz, cx, 1/2)`, der Kandidat liegt bei `Ursprung + (h mod cellRaw)`. Verworfen wird er
außerhalb der Karte oder der Form, bei `dryOnly` mit `h·s ≤ waterLevelRaw` am nächsten Sample sowie bei
`maxSlope > 0` mit `floor(isqrt(gx²+gz²)·1000/8192) > maxSlope`. Dabei ist gx/gz die Zentraldifferenz,
am Rand die einseitige Differenz ×2, alles in raw. Der Eintrag wird gewichtet über `rng32(…,3) mod Σw`
gewählt, außerdem `yaw = rng32(…,4) & 0xffff` und `scale = min + rng32(…,5) mod (max−min+1)`.
Außer dem Ergebnisobjekt gibt es keine Allokation pro Prop. Das Verfahren ist im Header von `propfields.ts`
dokumentiert.

### mapc (`scripts/mapc.ts`, additiv)

`markers.json` akzeptiert optional `propFields: [{ name, kind, shape: {circle:{x,z,r}} | {polygon:[[x,z],…]},
entries:[{id, weight?=1}], density, seed, scale?=[1,1], maxSlope?=0, dryOnly?=false, reclaimMass?=0,
reclaimEnergy?=0 }]`. Umrechnung: WU → raw über `Math.round(v·4096)`, Dezimalwerte → ×1000 gerundet.
Ohne den Schlüssel bleibt die Ausgabe bytegleich; `pnpm maps` ist idempotent (content/maps unverändert).

## Dateien

- neu: `packages/formats/src/propfields.ts`, `packages/formats/src/mapprop.ts`,
  `packages/formats/test/propfields.test.ts`, `packages/formats/test/legacy-maps.test.ts`,
  `packages/formats/bench/propfields.bench.ts`
- geändert: `packages/formats/src/rtsmap.ts`, `packages/formats/src/index.ts`, `packages/formats/scripts/mapc.ts`,
  `packages/formats/test/rtsmap.test.ts` (Chunk-Order-Erwartung + neuer Block), `packages/formats/test/mapc.test.ts`
  (neuer Block), `packages/formats/package.json` (Script `bench`)

## Tests

`pnpm vitest run packages/formats`: 11 Dateien, **111 Tests grün**, davon 27 neu.

- `propfields.test.ts` (18): Codec-Roundtrip; Golden-Hex eines Beispielfelds inkl. Sim-Bytes; Leserfehler
  (Padding, reservierte Flags/Felder, Kind, Kreis mit Punkten, Anzahlen, Trunkierung, Trailing Bytes, UTF-8);
  fast-check-Property `write(read(write(m)))` bytegleich (150 Läufe, fester Seed, Kreise + Sternpolygone);
  Absent vs. leer; PFLD zwischen PROP und PREV; Aufbau der Sim-Bytes; Hash-Test (Name egal, 17 Parameter- und
  Reihenfolgevarianten ändern den Hash); jede Validierungsregel wirft `FormatError('bad-value')` mit Chunk `PFLD`;
  Prop-Budget und Zellgrenze; Geometrie (Rand, halboffene Kanten, konkaves U, 4096-WU-Extremwerte);
  Zellkante; Expansion mit Golden (380 Props, xxHash32 `0x1cedb935`), alle Punkte in der Form, Anzahl innerhalb
  ±15 % von Dichte·Fläche (Dichte 1/8/64/512), Gewichtsanteil 3:1, `dryOnly`/`maxSlope` gegen eine unabhängige
  Neigungsrechnung, stabile Reihenfolge und Unabhängigkeit von Nachbarfeldern; handgebauter Container.
- `legacy-maps.test.ts` (4): hollow-ridge, tessera, braidwater und setons: Chunkliste unverändert, `read → write`
  bytegleich, `propFields` fehlt, mapSimHash entspricht dem Golden (0x90ec94f0, 0x22cb60a8, 0xeeaec694,
  0x52eccf92), `propFields: []` lässt den Hash unverändert.
- `rtsmap.test.ts` (+3): PFLD-Reihenfolge; unbekannte Chunks vor/nach PFLD inkl. Fallback des Ankers;
  doppeltes PFLD; Bitflips im PFLD-Chunk werden alle erkannt.
- `mapc.test.ts` (+2): Umrechnung von propFields, Fehlermeldungen, Roundtrip.

Weitere Befehle, alle grün:

- `cd packages/formats && npx tsc -p tsconfig.json --noEmit`
- `tools/heavy npx tsc -b` (gesamt)
- `tools/heavy npx tsc -p tsconfig.tests.json`
- `npx eslint packages/formats --max-warnings 0` (inkl. `sim/determinism`)
- `tools/heavy npx depcruise … packages apps tools`: keine Verletzung, kein Zyklus
- `tools/heavy pnpm maps && git diff --exit-code -- content/maps`: unverändert

`tools/heavy pnpm lint` schlägt nur an bereits eingecheckten Dateien unter `docs/design/ui-mockups/**` fehl
(89 × `no-undef` für Browser-Globals, Stand aus dem Merge des Design-Branches). Das liegt außerhalb dieses
Pakets und ist unverändert; `packages/formats` ist lint-sauber.

## Messwerte (Apple M5 Pro, Node v24.18.0, `tools/heavy pnpm --filter @faf/formats bench`, 25 Läufe + 3 Warm-up)

| Messung | Ergebnis |
|---|---|
| Expansion 29.978 Props (16 Felder auf Setons-Höhen, Dichte 71, halb dryOnly+maxSlope) | p50 8,0 ms · p95 9,0 ms |
| Validierung (Zählpass) derselben Felder | p50 3,9 ms |
| Expansion 64.674 Props (Dichte 153) | p50 17,6 ms · p95 22,9 ms |
| Validierung (Zählpass) 64.674 | p50 8,5 ms |
| PFLD encode, 256 Felder (67.700 B, je 4 Einträge, halb 32-Punkt-Polygone) | p50 0,15 ms |
| PFLD decode, 256 Felder | p50 0,11 ms |
| setons.rtsmap read / write (Legacy, 2,7 MB) | p50 5,8 ms / 5,7 ms |
| Setons + Felder mit 65k Props: read / write (inkl. Validierung) | p50 15,0 ms / 15,2 ms |

Das Ergebnis-JSON liegt in `packages/formats/bench/results/propfields-<Zeitstempel>.json` (gitignored). Es
dient nur der Messung, ein Gate gibt es nicht (DECISIONS 16).

## Abweichungen und Entscheidungen

1. **`mapprop.ts` neu:** `MapProp`, `PROP_ID_RE`, `MAP_MAX_PROPS` und `MAP_MAX_PROP_ID_BYTES` sind in ein
   eigenes Modul gewandert. Grund: `rtsmap.ts` importiert `propfields.ts`, und depcruise (`no-circular`,
   `tsPreCompilationDeps`) verbietet auch reine Typ-Zyklen. `rtsmap.ts` re-exportiert alles, die Paket-API
   bleibt identisch.
2. **Zusätzliche Grenze `MAP_MAX_FIELD_CELLS = 2^21`** für die Summe der Kandidatenzellen aller Felder (Bounding-Box
   auf die Karte geklemmt). Ohne sie könnte eine gültige Einzelregel, etwa Dichte 4096 auf 4096 WU mit dryOnly
   unter Wasser, zig Millionen Zellen erzeugen, die Validierung ließe sich also für Sekunden blockieren.
   Legitime Felder liegen um Größenordnungen darunter: 65k Props brauchen bei voller Füllung etwa 65k Zellen.
   `expandPropField` prüft dieselbe Grenze pro Feld und validiert das Feld vorher einzeln (für
   ungespeicherte Editor-Felder).
3. **Neigung:** Weil Zentral- und einseitige Differenzen verschiedene Abstände haben, wird die einseitige
   Randdifferenz ×2 genommen. So beziehen sich beide auf 8192 raw (zwei Samples). Formel im Header.
4. **Gewichtete Auswahl und Skalierung** nutzen `mod` wie die Positionsbestimmung (Bias ≤ Σw/2^32,
   vernachlässigbar) statt `rngRange`. Das ist Teil von Algo v1.
5. **Rand-Semantik:** Kreis geschlossen (`≤ r²`), Polygon halboffen (Crossing Number: eine Kante zählt, wenn genau
   ein Endpunkt `z > pz` hat). Beides ist deterministisch dokumentiert und getestet.
6. **mapc:** `entries[].weight` hat den Default 1, `scale` den Default `[1, 1]`. Die Vorschau (PREV) zeichnet keine
   Prop-Felder, damit bestehende Karten bytegleich bleiben.
7. `rtsmap.test.ts`: Die bestehende Erwartung `RTSMAP_CHUNK_ORDER` wurde zwangsläufig um `'PFLD'` erweitert.
   Alles andere ist additiv.

## Offene Punkte für Folgepakete

- **Editor (M12, P1 ff.):** `propFields` im Store als `MapPropField[]` (raw) halten, Vorschau über
  `expandPropField(map, i)` (ca. 0,3 µs/Prop). `validatePropFields`/`writeRtsMap` liefern `FormatError`
  mit Chunk `PFLD` und einem Pfad wie `propFields[i].shape…` für die Fehleranzeige. Symmetrie-Werkzeuge müssen
  Polygonpunkte spiegeln. Bei Achsenspiegelung kehrt sich die Orientierung um, was erlaubt ist.
  Achtung: Ein gespiegeltes Feld erzeugt wegen des globalen Gitters **kein** punktgenau gespiegeltes
  Prop-Muster, nur eine statistisch gleichwertige Verteilung, und zwar unabhängig vom Seed.
- **Symmetrische Expansion** (gespiegelte Props statt gespiegelter Felder) sieht das Format nicht vor. Falls
  gewünscht, als neues Flag-Bit mit `PROPFIELD_ALGO_VERSION` 2 lösen.
- **MS8/E8 (Sim):** `mapSimData` um die expandierten Props erweitern (`expandPropFields` im Sim-Worker, ~18 ms
  für 65k einmalig beim Laden). Reclaim-Werte sind pro Prop in Milli-Einheiten verfügbar. Die mapSimHash-Goldens
  bestehender Karten bleiben gültig, solange sie keine Felder bekommen.
- Der Lint-Befund in `docs/design/ui-mockups/**` (Browser-Globals) sollte im Design-Track per ESLint-Override
  oder -Ignore behoben werden.
