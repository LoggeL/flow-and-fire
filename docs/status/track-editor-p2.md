# TRACK-EDITOR · P2 – Datenmodell, Undo/Redo, Symmetrie, markers.json, EditorStore, Roundtrip gegen den Spiel-Loader

Stand: 2026-09-29 · Worktree `faf-editor`, Branch `track-editor` · Welle 1 · DOM-frei

## Umfang

Alles liegt unter `apps/marker-editor/src/model/**` und `src/app/store.ts`. Der Code ist reiner Tool-Code ohne
DOM und ohne `Math.random`/`Date`. Alle Koordinaten sind Fx raw (Q20.12, Integer).

- **`model/types.ts`**: `MarkerRef`, `SymmetryMode`, `EditorIssue`, `Validator` und `ToolId` exakt wie vorgegeben.
- **`model/document.ts`**: `EditorDocument` als unveränderlicher Snapshot mit `fromBytes`/`fromMap`,
  `toRtsMap()` (gecacht) und `toBytes()` (über `writeRtsMap`). Die Original-`RtsMap` bleibt als `source` erhalten.
  Höhen, SPLT, PREV, PROP, unbekannte Chunks und alle META-Felder außer starts/spots werden **per Referenz**
  durchgereicht. Geändert werden nur `starts`, `spots` und `fields`.
  Weitere Hilfen: `has(ref)`, `positionOf(ref)` (Ankerpunkt), `freeArmy()`, `maxRaw`, `hasFieldChunk` sowie
  `sameRef()`.
  - PFLD-Regel: `propFields` ist genau dann vorhanden, wenn die Quelldatei PFLD hatte **oder** mindestens ein
    Feld existiert. Eine Datei ohne PFLD bleibt also ohne, solange sie kein Feld hat. Hatte die Datei PFLD
    und wird ihr letztes Feld gelöscht, bleibt `[]` stehen.
- **`model/ops.ts`**: Die Operationen sind reine Daten, `applyOp(doc, op)` liefert `{ doc, inverse }` mit exakter
  Inverse. Enthalten sind `addStart`, `addSpot`, `addField`, `moveMarkers` (Starts, Spots, ganze Felder und einzelne
  Polygonpunkte), `moveFieldVertex`, `insertFieldVertex` (`after = −1` fügt vor Punkt 0 ein), `deleteFieldVertex`
  (mindestens 3 Punkte bleiben), `setFieldRadius`, `updateField` (Patch ohne `shape`), `setStartArmy`,
  `deleteMarkers` und `batch`.
  Nach jeder Top-Level-Op werden die Invarianten geprüft, sonst gibt es `EditorOpError` bzw. `FormatError`, und das
  Dokument bleibt unverändert:
  - Koordinaten ganzzahlig in `[0, sizeWu·4096]`
  - 1–16 Starts mit eindeutiger Armee, aufsteigend sortiert
  - höchstens 1024 Spots und 256 Felder
  - bei Feld-Ops `validatePropFields` (einfache Polygone, Grenzen, Zell- und Prop-Budget)

  Damit ist **jedes Dokument jederzeit mit `writeRtsMap` schreibbar**.
- **`model/history.ts`**: Die Klasse `History` bietet `apply`/`undo`/`redo` mit einem Limit von 500 Einträgen
  (die ältesten fallen weg). Eine neue Op verwirft den Redo-Stack, eine abgelehnte Op zeichnet nichts auf.
  - **Gesten** (`beginGesture`/`endGesture`, verschachtelbar): Ein Drag ergibt einen Undo-Schritt. Aufeinanderfolgende
    `moveMarkers` mit denselben Refs werden zusammengefasst (Deltas summiert), ebenso `moveFieldVertex` und
    `setFieldRadius` auf dasselbe Ziel (erste Inverse, letzter Wert) sowie gleichförmige `batch`es. Ein langer Drag
    braucht dadurch O(1) Speicher.
  - `stateId` identifiziert den Zustand für das Dirty-Tracking. Ein Undo zurück auf den gespeicherten Stand ist
    wieder „sauber“.
- **`model/symmetry.ts`**:
  - Spiegelung: `mirrorPoint` exakt nach Vorgabe, dazu `mirrorDelta` (linearer Anteil für mitgeführte Zwillinge),
    `mirrorShape` und `mirrorField`.
  - Hälften: `sideOfPoint`, `sideOfShape`.
  - Abgleich: `isMirrorShape` (Polygon zyklisch, in beide Richtungen), `findTwin`, `isSymmetric`.
  - `symmetrizeOp(doc, mode, keep)` erzeugt **eine** Op, also einen Undo-Schritt.
- **`model/markers-json.ts`**: `toMarkersJson(doc)` und `markersObject(map)` im mapc-Format. Werte werden in WU als
  `raw/4096` geschrieben (exakt), mit 2 Leerzeichen Einrückung, Zeilenumbruch am Ende und der Schlüsselreihenfolge
  der eingecheckten Quellen. `propFields` wird genau dann ausgegeben, wenn PFLD vorhanden ist.
- **`model/index.ts`**: Re-Export des Modells.
- **`app/store.ts`**: `EditorStore` auf `@preact/signals`, DOM-frei. Die API entspricht exakt der Vorgabe. Ergänzt
  wurden `openMap(map, fileName)`, der Konstruktorparameter `historyLimit` sowie die Exporte `defaultField`,
  `FIELD_KIND_DEFAULTS` und `DEFAULT_SNAP_RAW`.
  - Positionen werden auf `snapRaw` gerundet (0 = nur ganzzahlig) und auf die Karte geklemmt, Radien auf
    `[4096, S]`.
  - Live-Symmetrie (`liveSymmetry && symmetry !== 'none'`) führt den Zwilling bei Add, Move, Vertex-Move,
    Vertex-Insert, Radius, updateField und Delete in derselben Op mit (ein Undo-Schritt).
  - Abgelehnte Befehle ändern nichts und schreiben den Grund in `status` (deutsch, „Nicht möglich: …“).
  - `revision` zählt bei open, jeder Änderung, undo und redo hoch. Der Validator läuft bei jeder Revision synchron,
    und `issues` wird in derselben `batch` gesetzt. Wirft der Validator, entsteht ein Issue `validator-failed`.
  - `dirty` wird über den `stateId` der History berechnet.
  - `expandedProps()` wird je Revision gecacht.
  - Die Selektion wird nach jeder Änderung bereinigt: nicht mehr existierende Refs fallen heraus. Nach Add ist das
    neue Objekt selektiert, nach `setStartArmy` folgt die Selektion dem Start.

### Feld-Default-Template (Begründung)

| Wert | Default | Begründung |
|---|---|---|
| kind / entries | `tree`, `[{id:'core:tree_01', weight:1}]` (rock → `core:rock_01`, wreck → `core:wreck_01`) | Vorgabe. Bei rock/wreck wäre ein Baum-Eintrag falsch, deshalb hat jede Art ihre eigene Default-ID. |
| densityPerKWu2 | 64 | Zellgröße 4 WU, etwa 1 Prop je 16 WU². Ergibt einen lichten Wald, durch den sich Einheiten noch bewegen können. 30k Props (Budget-Richtwert MS8) entsprechen etwa 470k WU² Waldfläche. |
| scale | 800..1200 ‰ | ±20 % Größenvariation vermeiden sichtbare Uniformität. |
| maxSlopePermille | 600 | Anstieg 0,6 (≈ 31°). Keine Bäume an Klippen und steilen Rampen, auf Hängen schon. |
| dryOnly | true | Keine Props unter der Wasserlinie (Uferwald). |
| reclaim tree | Masse 0 / Energie 25000 milli (= 25 E) | Bäume sind im FA-Vorbild die Energiequelle des Reclaims. 25 E pro Baum sind bei 30k Bäumen eine spürbare, aber nicht dominante Menge. |
| reclaim rock | Masse 10000 milli (= 10 M) / Energie 0 | Felsen liefern Masse. 10 M pro Felsen sind einzeln klein, über ein Feld mit einigen Dutzend Felsen aber ein lohnendes Reclaim-Ziel. |
| reclaim wreck | Masse 30000 milli (= 30 M) / Energie 0 | Eigene Wahl (nicht vorgegeben): Map-Wracks sind wertvoller als Felsen. |
| seed | `rng32(revision, fieldIndex, 0x6d6b6564, 0)` | Deterministisch aus Revision und Index, also gleiche Befehlsfolge ⇒ gleiche Karte. |
| name | `"<kind> <index+1>"` | Nur ein Label (kein Einfluss auf mapSimHash). |

Alle Reclaim-Werte sind Platzhalter für das Balancing in MS8/E8. Sie stehen nur im Template und sind pro Feld
änderbar.

### Symmetrie-Details

- **Hälften:** Bestimmt über das Vorzeichen einer ganzzahligen Achsenfunktion f. Bei `point` gilt `2x−S`, bei
  Gleichstand `2z−S`. Bei `mirrorX` gilt `2x−S`, bei `mirrorZ` `2z−S`, bei `diagonal` `x−z`, bei `antiDiagonal`
  `x+z−S`. f < 0 ist Hälfte `a`, f > 0 Hälfte `b`. f = 0 heißt „auf der Achse“: Solche Marker gehören beiden
  Hälften an, werden behalten und nie dupliziert.
  - Felder: Polygone über die Punktsumme (mit n skaliert, exakt), Kreise über den Mittelpunkt.
  - Bei `point` liegt nur der exakte Kartenmittelpunkt „auf der Achse“.
- **symmetrizeOp:**
  - Marker der anderen Hälfte, die schon exakt das Spiegelbild eines behaltenen Markers sind (Spots gleicher Art,
    Felder mit gleichen Parametern außer Name/Seed), bleiben unangetastet. Eine symmetrische Karte ergibt daher einen
    **leeren Batch**.
  - Alle anderen Marker der anderen Hälfte werden gelöscht. Fehlende Spiegelbilder werden angehängt, Starts an ihre
    sortierte Position.
  - Armee eines gespiegelten Starts: die Armee des nächstgelegenen gelöschten Starts der anderen Hälfte (bei 2
    Starts also 0 ↔ 1), sonst die kleinste freie Armee.
- **Spiegelfelder:** Seed = `seed XOR 0x9e3779b9` (`MIRROR_SEED_XOR`, involutiv: zweimal spiegeln ergibt den alten
  Seed). Der Name bleibt gleich. Das gilt auch beim Live-`updateField` des Zwillings. Wie in P0 notiert, ist das
  expandierte Prop-Muster wegen des globalen Gitters nur statistisch symmetrisch.
- **findTwin:** Exakte Koordinaten. Spots müssen dieselbe Art haben, Felder dieselbe Art und die gespiegelte Form.
  `fieldVertex` findet den Punkt des Zwillingsfelds an der gespiegelten Stelle, `fieldRadius` den Radius-Griff des
  Zwillingskreises. Ein Marker auf der Achse ist sein eigener Zwilling, der Store überspringt ihn dann.

## Dateien

- `apps/marker-editor/src/model/{types,document,ops,history,symmetry,markers-json,index}.ts`
- `apps/marker-editor/src/app/store.ts`
- `apps/marker-editor/test/model/{support.ts, document,ops,history,symmetry,markers-json,store,property,roundtrip-game}.test.ts`
- `docs/status/track-editor-p2.md`

## Tests

`pnpm vitest run apps/marker-editor/test/model`: **8 Dateien, 89 Tests grün**, 2,6 s (davon Property-Tests 2,4 s).

- **document** (10):
  - Alle 4 Karten laden und exportieren bytegleich, auch in zweiter Generation. Der mapSimHash entspricht dem Golden
    (0x90ec94f0 / 0x22cb60a8 / 0xeeaec694 / 0x52eccf92), PFLD fehlt.
  - Durchreichen per Referenz (Höhen, Splat, Preview, Props, Light, Strata, unbekannte Chunks); unbekannte Chunks
    bleiben an ihrer Position.
  - PFLD-Regeln: absent ↔ `[]`, und ein leeres PFLD ändert den Hash nicht.
  - Defekte Datei wirft `FormatError`; außerdem `has`/`positionOf`/`freeArmy`/`sameRef`.
- **ops** (25):
  - Jede Op wird geprüft mit apply, dann Undo (Bytes wie vorher) und Redo (Bytes wie nach apply).
  - Sonderfälle: sortiertes Einfügen der Starts; Tausch bei `setStartArmy`; gemischtes `deleteMarkers` in
    ungeordneter Reihenfolge mit Duplikaten; `batch`; ein Feld und sein Punkt werden nur einmal bewegt.
  - 11 Invariantenverletzungen werfen `EditorOpError`.
  - 5 Feldverletzungen werfen `FormatError`, das Dokument bleibt unverändert: sich selbst schneidendes Polygon, Radius
    < 1 WU, Dichte 0, ungültige ID, Skalierung min > max.
- **history** (7):
  - Grundlagen: do/undo/redo; eine neue Op verwirft Redo; eine abgelehnte Op zeichnet nichts auf.
  - Gesten-Koaleszenz: 100 Moves plus 2 Batches ergeben einen Schritt mit summiertem Delta, Undo/Redo bytegleich.
    Wechselnde Vertex- und Radius-Ops in einer Geste bilden einen Schritt; ein reiner Radius-Drag wird zu einem Paar
    zusammengefasst.
  - Verschachtelte Gesten und Undo während einer Geste.
  - Limit 500 (520 Ops, die ältesten fallen weg) und Limit 3; `stateId`.
- **symmetry** (12):
  - Definitionen exakt. fast-check mit 400 Läufen über alle Modi und Kartengrößen 64–4096: Involution, Bild im
    Quadrat, Hälfte kippt, Fixpunkte genau auf der Achse, `mirrorDelta` gleich dem linearen Anteil.
  - Felder: Spiegelung involutiv inkl. Seed-XOR; Polygonabgleich zyklisch und richtungsfrei.
  - **Setons und Tessera sind exakt punktsymmetrisch:** `isSymmetric` ist true, `symmetrizeOp` (a und b) ergibt einen
    leeren Batch, die Bytes bleiben unverändert. Hollow Ridge ist ebenfalls punktsymmetrisch.
  - Einzelfälle:
    - symmetrize als ein Undo-Schritt mit Armeetausch 0 ↔ 1
    - `keep b` verwirft den unpassenden Marker
    - mirrorX mit Achsen-Spot, Achsen-Feld, verlorenem Feld und Seed-XOR
    - neue freie Armee bei `diagonal`
  - Alle 5 Modi × a/b auf einem asymmetrischen Dokument: symmetrisch, 1 Schritt, Undo bytegleich.
  - `findTwin` für Feld, Radius, Vertex und Achse.
- **markers-json** (7):
  - **Für alle 4 Karten ergibt Export plus Originalquellen (Heightmap, Splat-PNGs) über `compileMap` von mapc
    (`--preview`) eine bytegleiche `.rtsmap`.**
  - Das Format entspricht der Quelle (Schlüssel und Werte von hollow-ridge/markers.json).
  - Bearbeitetes hollow-ridge (Start, 2 Spots, Move mit krummen Raw-Werten, Kreis- und Polygonfeld mit
    Extremwerten wie Gewicht 65535 und Reclaim u32-max): compile liefert dieselben starts, spots (mass zuerst, siehe
    Abweichungen), props, propFields, light, strata und dasselbe Wasser.
  - Props mit yaw/scale ≠ Default und ein leeres PFLD überstehen den Weg.
- **store** (20):
  - Signale, Defaults und bytegleicher Export; open eines defekten Files ändert nichts; open leert History,
    Selektion und Hover.
  - Snap und Klemmen (inkl. `snapRaw = 0`); freie Armee und Limit 16; `dirty` inkl. Undo auf den gespeicherten Stand.
  - Revision und Validator synchron, per `effect` beobachtet, inkl. Fehler- und Null-Validator.
  - Abgelehnte Befehle landen in `status`.
  - Feld-Defaults, Rock-Template, deterministischer Seed; `expandedProps`-Cache.
  - Vertex-, Insert-, Radius-, Update- und Delete-Folge mit vollständigem Undo bytegleich.
  - Selektion additiv; Gesten-Snap-Akkumulation; Klemmen der ganzen Selektion; `setStartArmy` mit Selektion.
    Der letzte Start bleibt erhalten, Undo bereinigt die Selektion.
  - Live-Symmetrie:
    - Add, Geste, Vertex, Insert, Update und Delete halten die Karte symmetrisch, und das vollständige Undo ist
      bytegleich.
    - Radius-Zwilling; Achsen-Spot wird nicht dupliziert.
    - `symmetrize`-Befehl.
- **property** (2, fast-check mit festen Seeds):
  - History-Ebene: **250 Läufe**, je 1–30 zufällige Ops aller Arten inkl. ungültiger Ops, Gesten, Undo/Redo
    zwischendurch und symmetrize. Danach alles Undo ⇒ Bytes == Original, dann genau so viele Redo ⇒ Bytes == Stand
    vor dem Undo. Abgelehnte Ops verändern nachweislich nichts.
  - Store-Ebene: **200 Läufe** mit Befehlen, Selektion, Gesten, wechselnder Live-Symmetrie und Snap. Dieselben
    Aussagen gelten, zusätzlich `dirty == false` nach vollständigem Undo.
- **roundtrip-game** (6):
  - Für alle 4 unveränderten Karten und für bearbeitete Karten:
    - hollow-ridge: Start, 2 Spots, Move, 2 Felder
    - setons: unter Live-Punktsymmetrie
  - Export → Bytes → `ClientMap.fromBytes` (`@faf/client`, der Paket-Index lädt in Node) sowie `resolveMap` und
    `new SimCore({ simBin: content/generated/sim.bin, map: bytes })` (`@faf/sim-host`) → `writeRtsMap(...)`, jeweils
    **bytegleich** mit dem Editor-Export.
  - `SimCore.mapSimHash == mapSimHash(formats)`. Starts und Spots von Client und `mapSimData` entsprechen dem Editor.
  - Nach vollständigem Undo liegt wieder die eingecheckte Datei vor.

Weitere Selbsttests, alle grün:

- `cd apps/marker-editor && npx tsc -p tsconfig.json --noEmit`
- `tools/heavy npx tsc -p tsconfig.tests.json` (inkl. aller Testdateien)
- `npx eslint --max-warnings 0 apps/marker-editor/src/{model,app} apps/marker-editor/test/model`
- `tools/heavy pnpm lint` (eslint + depcruise, 480 Module, keine Verletzung; `src/` importiert nur formats, fixed
  und `@preact/signals`)

## Messwerte (lokal, Apple M5 Pro, Node v24.18.0, tsx; `performance.now`, Stichproben)

| Messung | Ergebnis |
|---|---|
| `store.open(setons)` (2,7 MB, readRtsMap + Validierung) | 6,5 ms |
| `exportBytes` Setons + 32 Felder | p50 6,4 ms · p95 8,4 ms |
| `moveSelectionBy` Feld + Live-Zwilling (32 Felder, volle `validatePropFields`) | p50 0,19–0,20 ms · p95 0,33–0,38 ms |
| `moveSelectionBy` Spot + Zwilling | p50 0,003 ms |
| Undo-Schritt (Feld-Ops) | p50 0,17 ms · p95 0,26 ms |
| `expandedProps()` 32 Felder, 2.254 Props (Cache-Miss) | 0,9 ms |
| `exportMarkersJson` Setons | 0,16 ms |
| Vitest `test/model` gesamt | 2,6 s (Property 2,4 s) |

Ein Drag bleibt damit weit unter 1 ms pro Mausschritt. Den Frame-Anteil treiben also Overlay und Validator (P3/P4),
nicht das Modell.

## Abweichungen und Entscheidungen

1. **Neue Starts werden sortiert eingefügt statt angehängt.** Die Formatregel „starts aufsteigend nach army“ hat
   Vorrang. `addStart` im Store nimmt die kleinste freie Armee, bei 0/1 belegt also 2 (in der Praxis meist
   „angehängt“). Spots und Felder werden angehängt.
2. **`setStartArmy` tauscht:** Hat ein anderer Start die Zielarmee, bekommt er die alte Armee. Danach wird neu
   sortiert, und die Selektion folgt dem Start.
3. **Feld-Invarianten werden bei jeder Feld-Op geprüft** (`validatePropFields` auf dem ganzen Dokument, ≈ 0,2 ms bei
   32 Feldern). Ungültige Zwischenzustände, etwa ein sich selbst schneidendes Polygon beim Vertex-Drag, werden
   abgelehnt: Der Punkt bleibt an der letzten gültigen Stelle, `status` nennt den Grund. So ist jedes Dokument
   exportierbar, was der Property-Test (Redo-Bytes) voraussetzt.
4. **Mindestens 1 Start:** `deleteSelection` behält den letzten Start (Hinweis in `status`), `applyOp` lehnt das
   Löschen aller Starts ab.
5. **PFLD nach Session-Feldern:** Wird in einer Datei ohne PFLD ein Feld angelegt und wieder gelöscht, fällt PFLD
   wieder weg (Regel „Quelle hatte PFLD oder ≥ 1 Feld“). So bleibt die Datei auch ohne Undo bytegleich zum Original.
6. **Snapping beim Verschieben:** Gerundet wird die **Zielposition des Ankers** (erster selektierter Marker), nicht
   das Delta. In einer Geste summieren sich die Deltas ab Gestenbeginn, kleine Mausschritte gehen also nicht
   verloren. Das Klemmen gilt für die ganze Selektion (Bounding-Box; bei Kreisen der Mittelpunkt).
7. **Semantik der Refs:** In Move und Delete zählt `fieldRadius` als das Feld. `deleteSelection` mit `fieldVertex`
   löscht Punkte und lehnt ab, wenn danach weniger als 3 übrig blieben. Ein Punkt, dessen Feld mitselektiert ist,
   wird nicht doppelt bewegt.
8. **markers.json:** mapc listet erst alle mass-, dann alle hydro-Spots. Eine im Editor gemischte Reihenfolge geht
   im JSON-Export verloren (der Binärexport bleibt exakt). `yawDeg`/`scale` fehlen bei den mapc-Defaults 0/1.
   `heightScaleRaw` wird immer als Raw-Wert geschrieben.
9. **Live-Symmetrie, Grenzfälle:** Ist das Zwillingsfeld dasselbe Feld (selbstsymmetrisches Polygon), wird ein
   eingefügter Punkt nicht gespiegelt. Ein Punkt-Move dagegen wird gespiegelt, wenn der Zwillingspunkt ein anderer
   Punkt desselben Felds ist. Die Zwillinge einer Move-Geste werden zu Gestenbeginn bestimmt und für die ganze
   Geste festgehalten.
10. **Store-Ergänzungen** (keine Umbenennungen): `openMap`, Konstruktor `historyLimit`, `defaultField`,
    `FIELD_KIND_DEFAULTS`, `DEFAULT_SNAP_RAW`. Die History bietet zusätzlich `stateId`, `undoLabel`/`redoLabel` und
    `inGesture`.
11. Die Statusmeldungen des Stores sind deutsch (UI-Text). Die Fehlertexte aus `ops.ts`/`formats` bleiben englisch
    und werden mit „Nicht möglich: …“ eingeleitet.

## Offene Punkte für Folgepakete

- **P3 (Validierung):** `store.setValidator(v)` ruft `v` bei **jeder** Revision synchron auf, also auch bei jedem
  Drag-Schritt. Kostet der Validator auf Setons mehr als ≈ 2 ms, sollte P5 ihn während einer Geste aussetzen,
  etwa mit `setValidator(null)` in `beginGesture` und dem erneuten Setzen in `endGesture` (die Revision löst dann
  aus). Alternativ lässt sich im Store ein Flag ergänzen. `EditorIssue.refs` nutzt die `MarkerRef`-Indizes des
  aktuellen Dokuments.
- **P4/P5 (Overlay, Controller):**
  - Marker-Positionen liefert `store.doc.value.positionOf(ref)`.
  - Vertex-Drag geht über `moveVertex` (absolut), Radius-Drag über `setFieldRadius` (absolut), Marker-Drag über
    `moveSelectionBy` (relativ). Alle drei gehören zwischen `beginGesture()`/`endGesture()`.
  - `hover` wird bei Änderungen bereinigt.
  - `expandedProps()` ist je Revision gecacht, für Prop-Vorschau-Instanzen also direkt nutzbar.
- **P6 (UI):**
  - Undo/Redo-Tooltips über `History.undoLabel`/`redoLabel`; diese sind noch nicht als Signal im Store und können bei
    Bedarf ergänzt werden.
  - `status` ist ein einfacher String-Signal.
  - Die Symmetrie-Buttons rufen `symmetrize(mode, 'a' | 'b')` auf. Die Hälften sind oben definiert: a = links, oben,
    x < z bzw. x + z < S.
- **MS8/E8:** Die Reclaim- und Dichte-Defaults im Template sind Platzhalter fürs Balancing. Eine symmetrische
  Prop-Expansion (Flag-Bit, Algo v2) würde auch das Prop-Muster der Spiegelfelder exakt spiegeln.
