# TRACK-EDITOR · P3 – Validierung (flaches Land, Abstände, Erreichbarkeit über Neigung) + Benchmark

Stand: 2026-09-29 · Branch `track-editor` · Welle 1 · Paket `@faf/marker-editor` (nur `src/validate/**`, `test/validate/**`, `bench/**`, `package.json`)

## Umfang

Die Validierung des Marker-Editors prüft Startpositionen, Mass-/Hydro-Spots und Prop-Felder gegen das Terrain. Sie liefert
eine deterministische Liste von `EditorIssue` mit festen Codes, deutschen Meldungen, Position in Fx raw und Verweisen
(`MarkerRef`) auf die betroffenen Marker. Die Schnittstelle zum Store (P2) ist `Validator = (map: RtsMap) => readonly EditorIssue[]`,
also `store.setValidator(createValidator())`.

- **`src/validate/types.ts`**: `MarkerRef`, `SymmetryMode`, `EditorIssue` und `Validator`. Sie sind strukturell identisch zum Vertrag aus P2/P4 und werden nicht importiert. Dazu kommt `ISSUE_CODES` (alle Codes als Konstante) und der Typ `IssueCode`.
- **`src/validate/terrain.ts`**: `createTerrainAnalysis(map, { maxSlopePermille? })` → `TerrainAnalysis`
  - Neigung je Sample über Zentraldifferenzen. Am Rand wird die einseitige Differenz ×2 genommen, sodass sich jeder Gradient auf 2 Samples = 8192 raw bezieht, wie in `propfields.ts` (P0) und `tessera.test.ts`. Gespeichert als `slopePermille` (Uint16, `floor(isqrt(G²)·1000/8192)`). Das ist exakt die Größe, gegen die `MapPropField.maxSlopePermille` expandiert.
  - Land-Passierbarkeit: `!isDeepWaterForLand` (@faf/rules) und Neigung ≤ 0,6 (PLAN §3.9). Der Neigungstest ist exakt ganzzahlig (`G²·10⁶ ≤ m²·8192²`). Gegen die Float-Referenz aus `tessera.test.ts` gibt es auf allen vier Karten 0 abweichende Samples.
  - Zusammenhangskomponenten über 4-Nachbarschaft: iterativer Flood-Fill mit einem einzigen `Int32Array`-Stack, ohne Rekursion. Ergebnis sind `labels: Int32Array` (`NO_COMPONENT = −1` für unpassierbar), `componentSizes: Int32Array` und `componentCount`. Die Nummerierung folgt der Scan-Reihenfolge und ist damit deterministisch.
  - Abfragen: `sampleIndexAt`, `isPassableAt`, `componentAt(x, z, searchRadiusRaw)`. Liegt ein Marker auf einem unpassierbaren Sample, etwa einer kleinen Kuppe oder einer Rampenkante, rastet er auf das nächste passierbare Sample im Suchradius ein. Gleichstände entscheidet die Scan-Reihenfolge.
- **`src/validate/rules.ts`**: `validateMap(map, analysis, options?)` mit den Regeln aus der Tabelle unten, `DEFAULT_VALIDATION_OPTIONS` (eingefroren), `resolveValidationOptions`, `detectSymmetry`, `mirrorPoint` (Konvention wie im Modell von P2: mirrorX `(S−x, z)`, mirrorZ `(x, S−z)`, diagonal `(z, x)`, antiDiagonal `(S−z, S−x)`), `fieldPoints` (Expansions-Cache) und `fmtWu`.
  Reihenfolge der Ausgabe: erst nach Schwere (error, warning, info), dann nach Regel und Markerindex (stabile Sortierung).
- **`src/validate/index.ts`**: `createValidator(options?)` → `CachingValidator` (ist ein `Validator`, dazu `analysisBuilds()` und `analysis()`). Die TerrainAnalysis wird über den Schlüssel (heights-Objekt, heightScaleRaw, waterLevelRaw, sizeWu) gecacht; es bleibt immer nur der letzte Eintrag erhalten. `options` = Teil-`ValidationOptions` plus `maxSlopePermille`. Re-Exporte: `createTerrainAnalysis`, `validateMap`, `DEFAULT_VALIDATION_OPTIONS` und alle Typen.
- **Expansions-Cache für Prop-Felder:** Die Expansion hängt nur vom Feld und vom Terrain ab. Deshalb liegt pro TerrainAnalysis eine `WeakMap<MapPropField, FieldPoints>` (nur x/z als Int32Array). Wer einen Marker verschiebt oder Felder umsortiert, löst keine neue Expansion aus. Ein geändertes Feld ist ein neues Objekt und wird genau einmal expandiert (Zähler `fieldExpansionStats` für Tests und Benchmark).

### Regeln und Codes

| Code | Schwere | Bedingung (Default) | refs |
|---|---|---|---|
| `start-count` | error | < 2 Starts | alle Starts |
| `start-count` | warning | Armeen nicht lückenlos 0..n−1 | alle Starts |
| `start-edge` | error | Start < 16 WU vom Rand | Start |
| `spot-edge` | error | Spot < 12 WU vom Rand (DECISIONS 29) | Spot |
| `start-in-water` / `spot-in-water` | error | `waterLevel − h ≥ 0` (nur bei Karten mit Wasser) | Marker |
| `spot-not-flat` | error | max \|h − h(Spot)\| im Radius 1,5 WU > 0,5 WU | Spot |
| `spot-not-flat` | warning | max \|h − h(Spot)\| im Radius 3 WU > 0,1 WU (410 raw) | Spot |
| `start-not-flat` | warning | Bauplatz (Samples im Radius 8 WU) zu < 50 % passierbar | Start |
| `spot-overlap` | error | zwei Spots < 2 WU | beide Spots |
| `spot-close` | warning | zwei Spots < 4 WU | beide Spots |
| `spot-on-start` | error | Spot < 4 WU von einem Start | Spot, Start |
| `start-close` | error / warning | zwei Starts < 48 WU / < 96 WU | beide Starts |
| `start-unreachable` | error | Start nicht in der Land-Komponente mit den meisten Starts (Gleichstand: die des niedrigsten Startindex) oder auf unpassierbarem Gelände | Start |
| `spot-unreachable` | warning | Spot in keiner Komponente eines Starts (Insel, abgeschnittenes Plateau: nur per Luft/Wasser) | Spot |
| `field-invalid` | error | Feld lässt sich nicht expandieren (`FormatError` aus `expandPropField`, Meldung übernommen) | Feld |
| `field-covers-spot` | warning | expandierte Feld-Props < 2 WU an einem Spot bzw. < 8 WU an einem Start (je Marker × Feld ein Eintrag, mit Anzahl und kleinstem Abstand) | Marker, Feld |
| `field-empty` | warning | Feld expandiert zu 0 Props | Feld |
| `prop-count` | error | PROP-Einträge + Expansion > `MAP_MAX_PROPS` | alle Felder mit Props |
| `asymmetric` | info | genau ein Eintrag: erkannte Modi („Symmetrie: point, diagonal …“, refs leer) oder „unter keiner Spiegelung symmetrisch“ mit den Markern ohne Gegenstück im besten Modus | – / Marker |

Einzelheiten zu den Messverfahren:

- **Flachheit:** Abtastgitter mit 0,25 WU Schrittweite (`flatProbeStepRaw`, um den Spot zentriert, `sampleHeightRaw`) innerhalb beider Scheiben. Beide Werte entstehen in einem Durchlauf mit höchstens 625 Abfragen je Spot.
- **Symmetrie:** Jeder Start und jeder Spot braucht unter dem Modus ein Gegenstück derselben Klasse (Start / Masse / Hydro) im Abstand ≤ 1 WU (`symmetryToleranceRaw`). Ein Marker auf der Achse ist sein eigenes Gegenstück.
- **Feld-Überdeckung:** Die Marker werden in ein Raster mit der größeren Freihaltedistanz eingeteilt. Jeder Prop prüft nur die 3×3 Nachbarzellen, der Aufwand ist also O(Props + Marker).

### Kalibrierung (bestehende Karten, keine Karte geändert)

Die Defaults aus der Aufgabe führen ohne Anpassung auf allen vier Karten zu **0 errors**. Gemessene Reserven zu den Schwellen:

| Karte | min. Spot–Rand | min. Start–Rand | max. Δh 1,5 / 3 WU | min. Spot–Spot | min. Spot–Start | min. Start–Start | Bauplatz passierbar | max. Spot-Tiefe |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| hollow-ridge | 78 | 96 | 0,06 / 0,28 | 20 | 20,4 | 452 | 100 % | −3,0 (trocken) |
| tessera | 30 | 108 | 0 / 0 | 22,6 | 16 | 419 | 100 % | −4,1 |
| braidwater | 18 | 66 | 0 / 0 | 22,6 | 16 | 380 | 100 % | −2,2 |
| setons | **12** (Grenze, DECISIONS 29) | 102 | 0 / 0 | 13 | 16 | 179 | 100 % | −2,2 |

Erwartete Warnungen, im Test `maps.test.ts` als exakte Liste festgeschrieben:

- hollow-ridge: `spot-not-flat` auf Masse-Spot 7 und 15. Beide liegen auf leicht geneigten Plateaus, im 3-WU-Radius gibt es 0,28 WU Höhenunterschied. Das ist ein echter Hinweis, kein Fehler.
- setons: `spot-unreachable` auf Masse-Spot 50–54 und 104–108 (die zwei Inseln mit je 5 Spots, per Design nur über Luft oder Wasser erreichbar).
- tessera, braidwater: keine Warnungen.

Erkannte Symmetrie: hollow-ridge `point`, tessera `point, diagonal, antiDiagonal`, braidwater `mirrorZ`, setons `point`.

Bei `startPlatformMinPassablePermille` wurde „überwiegend“ als > 50 % gelesen (Default 500). Alle Karten erreichen 100 %; die Schwelle hat also Luft für Starts am Klippenrand.

## Dateien

- `apps/marker-editor/src/validate/{types,terrain,rules,index}.ts`
- `apps/marker-editor/test/validate/{helpers.ts, terrain.test.ts, rules.test.ts, maps.test.ts, validator.test.ts}`
- `apps/marker-editor/bench/validate.bench.ts`, `apps/marker-editor/bench/tsconfig.json` (Typprüfung des Benchmarks, siehe Abweichungen), `apps/marker-editor/bench/results/.gitignore` (`*`, `!.gitignore`)
- `apps/marker-editor/package.json`: nur das Script `"bench": "node --import tsx bench/validate.bench.ts"` (Dependencies unverändert)

## Tests

`pnpm vitest run apps/marker-editor/test/validate`: 4 Dateien, **56 Tests grün** (≈ 0,6 s).

- **`terrain.test.ts` (10):**
  - Passierbarkeit auf allen 4 Karten bitgleich zur unabhängigen Float-Referenz (`Math.hypot`, wie in `tessera.test.ts`).
  - Label-Konsistenz: Jedes passierbare 4-Nachbarpaar hat dasselbe Label, die Größen stimmen, die Nummerierung folgt der Scan-Reihenfolge (auch Setons).
  - Neigung von Ebene und Rampe inklusive Randdifferenzen.
  - Exakte 0,6-Schwelle (76 vs. 77 Schritte/WU), `maxSlopePermille` konfigurierbar, Bereichsfehler.
  - Tiefes und flaches Wasser: Ein sanfter Graben sperrt allein über die Tiefe, genau 0,5 WU Tiefe ist noch passierbar.
  - Klippenring: Innen, Ringkrone und Außen sind drei getrennte Komponenten; Einrasten über `componentAt`; Rundung und Klemmung von `sampleIndexAt`.
  - Determinismus.
- **`rules.test.ts` (36):** Jede Regel wird positiv und negativ geprüft:
  - saubere Karte (nur Info)
  - `start-count` (1 bzw. 0 Starts, Lücke)
  - Rand (Start 15/16 WU, Spot 11/12 WU, auch am fernen Rand)
  - Spot/Start im See; genau auf Wasserhöhe zählt als Wasser, ein Schritt darüber als trocken; Karte ohne Wasser in Höhe 0 meldet nichts
  - Hang: Fehler bei Steigung 0,5, Warnung bei 1/16, Rampenfuß
  - Bauplatz: Kegel ergibt eine Warnung, eine kleine Klippe am Rand nicht
  - Spot-Abstände 1/3/5 WU, Spot am Start 3/5 WU, Starts 40/80/100 WU
  - Start hinter einem geschlossenen Klippenring ist ein Fehler, mit Pass nicht; Hauptkomponente = die mit den meisten Starts
  - Insel-Spot ergibt eine Warnung ohne Fehler; Spot auf einer 2×2-Kuppe rastet ein (mit Suchradius 0 wird er gemeldet)
  - Feld über Spot und über Start mit genauen refs; Feld im See mit `dryOnly` ist leer; ungültiges Feld ergibt `field-invalid` statt einer Exception
  - Prop-Überlauf mit 65 526 PROP-Einträgen plus Feld; `maxProps` als Option
  - Symmetrie: jeder Modus einzeln erkannt, Art und Toleranz, asymmetrischer Fall mit refs; `mirrorPoint`-Konvention
  - Eigenschaften der Liste: Sortierung, bekannte Codes, ganzzahlige raw-Positionen, gültige refs; Determinismus (JSON-gleich, auch mit frischer Analyse); Defaults
- **`maps.test.ts` (5):** 4 Karten mit 0 errors; Warnungsliste und Symmetrie exakt festgeschrieben. Auf Setons mit echtem Terrain erzeugen editierte Marker (Spot ins Meer, Spot auf Spot, Start neben Start) die erwarteten Fehler, und die Analyse wird wiederverwendet.
- **`validator.test.ts` (5):**
  - Cache greift: Die Analyse wird nur einmal gebaut, obwohl sich die Marker ändern. Neu gebaut wird bei neuem heights-Objekt, neuem Wasserspiegel, neuem heightScale oder neuer Größe.
  - Optionen werden durchgereicht.
  - Jedes Feld wird genau einmal pro Feldobjekt und Terrain expandiert.
  - Zwei Validatoren liefern auf Setons dieselbe Liste.

Weitere Selbsttests, alle grün:

- `cd apps/marker-editor && npx tsc -p tsconfig.json --noEmit`
- `npx tsc -p apps/marker-editor/bench/tsconfig.json --noEmit`
- `tools/heavy npx tsc -p tsconfig.tests.json`
- `tools/heavy pnpm lint`: eslint und depcruise, 467 Module, keine Verletzung
- `tools/heavy pnpm --filter @faf/marker-editor bench`

## Messwerte

Lokal gemessen auf Apple M5 Pro, Node v24.18.0, `tools/heavy pnpm --filter @faf/marker-editor bench`, 25 Läufe + 3 Warm-up.

| Karte | Größe | Marker | Komponenten | createTerrainAnalysis p50 / p95 | validate (Analyse gecacht, Spot verschoben) p50 / p95 | erster Aufruf p50 |
|---|---|---:|---:|---:|---:|---:|
| hollow-ridge | 512 | 20 | 1 | 3,3 / 3,8 ms | 0,07 / 0,09 ms | 3,8 ms |
| tessera | 512 | 40 | 29 | 3,3 / 3,9 ms | 0,08 / 0,09 ms | 3,5 ms |
| braidwater | 512 | 43 | 69 | 3,3 / 3,5 ms | 0,08 / 0,09 ms | 3,3 ms |
| **setons** | 1024 | 124 | 117 | **12,1 / 15,1 ms** (Ziel < 150) | **0,30 / 0,35 ms** (Ziel < 5) | 11,8 ms |

| Messung | Ergebnis |
|---|---|
| Setons + 16 Prop-Felder (≈ 30 k Props), Felder gecacht, Spot verschoben | p50 0,74 ms · p95 1,02 ms (0 Expansionen) |
| dasselbe, ein Feld pro Lauf geändert (eine Expansion) | p50 0,98 ms · p95 1,37 ms |
| setons.rtsmap `readRtsMap` / `writeRtsMap` (2,7 MB) | p50 5,4 / 5,8 ms · p95 6,8 / 7,4 ms |
| setons.rtsmap read + write | p50 10,9 ms · p95 13,4 ms, bytegleich |

Die Ergebnis-JSON liegt in `apps/marker-editor/bench/results/validate-<Zeitstempel>.json` (gitignored). Sie dient nur der Messung, ein Gate gibt es nicht (DECISIONS 16).

## Abweichungen und Entscheidungen

1. **Zusätzlicher Code `field-invalid` (error):** Der Store kann ungespeicherte, ungültige Felder halten, zum Beispiel mit Dichte 0 während der Eingabe. `expandPropField` wirft dann `FormatError`. Die Validierung fängt das ab und meldet es als Issue, statt die Liste scheitern zu lassen. `ISSUE_CODES` führt den Code.
2. **Nicht geprüft wird die Summe der Kandidatenzellen aller Felder** (`MAP_MAX_FIELD_CELLS`, P0). Pro Feld prüft `expandPropField` die Grenze selbst; eine Verletzung erscheint dann als `field-invalid`. Die Summengrenze über alle Felder meldet erst `writeRtsMap` beim Export. Ein eigener Zählpass hätte die Kosten der Expansion verdoppelt.
3. **`field-covers-spot`** prüft nur expandierte Feld-Props, keine expliziten PROP-Einträge, wie in der Aufgabe vorgegeben. Die Legacy-Props der vier Karten bleiben unbewertet.
4. **`asymmetric`** betrachtet nur Starts und Spots. Prop-Felder spiegeln wegen des globalen Expansionsgitters ohnehin nicht punktgenau (siehe P0).
5. **`validateMap` wirft**, wenn die übergebene Analyse zu einem anderen Höhenfeld gehört. Das ist ein Programmierfehler, kein Karten-Issue.
6. **Typprüfung des Benchmarks:** `tsconfig.tests.json` (nicht im Besitz von P3) erfasst `packages/*/bench/**`, aber nicht `apps/*/bench/**`. Deshalb gibt es `apps/marker-editor/bench/tsconfig.json` (noEmit, Node-Typen); `npx tsc -p apps/marker-editor/bench/tsconfig.json --noEmit` ist grün. ESLint erfasst `**/bench/**/*.ts` bereits.
7. **Tool-Code statt Sim-Code:** `src/validate` steht nicht unter `sim/determinism`. Trotzdem gibt es kein `Math.random`, `Date` oder `performance`. Float kommt nur in Meldungstexten (`toFixed`) und im korrekt gerundeten `Math.sqrt` vor. Die Passierbarkeit ist exakt ganzzahlig. `WeakMap` dient nur als Cache und beeinflusst die Ausgabe nicht.

## Offene Punkte für Folgepakete

- **P5:** `store.setValidator(createValidator())`. Beim Kartenwechsel entsteht ein neues heights-Objekt, damit wird die Analyse automatisch neu gebaut (Setons ≈ 12 ms). Die Heights dürfen **nicht in place** verändert werden, sonst bleibt die Analyse veraltet.
- **P6 (ValidationPanel):** `issue.x/z` sind Fx raw oder `null` (kartenweite Issues: `start-count`, `prop-count`, `asymmetric`). Bei `field-invalid`/`field-empty` zeigt x/z auf den Kreismittelpunkt bzw. den ersten Polygonpunkt. Die Meldungen sind fertig formuliert (deutsch, WU mit Dezimalkomma).
- **P7 (validation.spec.ts):** Codes `spot-in-water`, `spot-not-flat` und `spot-edge` wie gefordert. Die Warnungsliste der bestehenden Karten steht in `test/validate/maps.test.ts` und kann als Erwartung dienen (hollow-ridge 2 Warnungen, setons 10).
- **Performance-Grenzfall:** `asymmetric` und die Spot-Paare sind O(n²). Bei der Formatgrenze von 1.024 Spots sind das etwa 5 M Abstandsvergleiche (grob 10 ms). Für realistische Karten (≤ 200 Marker) ist das vernachlässigbar; falls nötig, ließe es sich auf das Raster aus `coverage` umstellen.
- `startPlatformMinPassablePermille` (500) und die Flachheitsschwellen sollten nach den ersten von Hand gebauten Karten noch einmal überprüft werden.
