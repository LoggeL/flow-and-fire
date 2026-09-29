# Entscheidungen (autonom getroffen, Nutzer: "ohne Rückfragen")

Stand 2026-09-28. Offene Entscheidungen aus PLAN.md §7:

1. **Reihenfolge:** (a) früher FA-Loop, Balancing nur einmal auf finaler Kampfphysik.
2. **Rust/WASM-Ausweg:** (a) vorab freigegeben, falls SPK1 das Tick-Budget verfehlt.
3. **Mauern:** (a) Minimal-Drag-Linie für Strukturen mit `wall`-Flag in MS8.
4. **Area-Reclaim (E14):** (a) wird mit E8 in MS8 ins MVP gezogen.
5. **GPU-Hardware:** Keine Iris-Xe/UHD-620-Runner verfügbar. Gemessen wird lokal (Apple M5 Pro) plus
   Playwright Chromium/Firefox/WebKit headless. GPU-/FPS-Gates gegen iGPU sind damit nicht belegbar und
   werden als "lokal gemessen" markiert.

Weitere pragmatische Anpassungen:
- **CI:** zunächst lokales Skript `pnpm ci:local` statt Hosted-CI (kein Remote-Repo).
- **Bun (JSC):** Cross-Engine-Determinismus über Node (V8) + Playwright WebKit (JSC) + Firefox (SpiderMonkey).
- **Spikes SPK1–SPK6:** als Benchmarks/Prototypen innerhalb von MS1 statt 7-Wochen-Block.
- **Name:** **Flow & Fire (FAF)** — Initialen als Anlehnung an Forged Alliance Forever. Ordner `flow-and-fire`, Paket-Scope `@faf/*`. (Anfangs-Codename `ironflow`, Umbenennung nach MS1.) Eigene Fraktion, keine FA-Namen/Assets.
- **Speicher:** Mac ohne Swap → max. 2 schwere Build-/Test-Agenten parallel.

## Nachtrag 2026-09-29 – Spike-Entscheidungen MS1

Gemessen lokal auf Apple M5 Pro (Node 24 + Playwright Chromium/Firefox/WebKit headless), nicht auf dem
Referenz-Laptop; Details und Rohdaten in `docs/STATUS.md` („Spike-Ergebnisse“) und `docs/status/P6-headless.md`.

6. **SPK1 Sim-Durchsatz → alles bleibt TypeScript.** Big-Battle-Prototyp (1.000 Boden, 300 Luft, ≈ 3.900 Projektile,
   Vision, Targeting, Hash) p95 max. 1,38 ms in der langsamsten Engine (Firefox kalt) bei 25 ms Budget. Der
   Rust/WASM-Ausweg aus Punkt 2 bleibt freigegeben, wird aber nicht gezogen. Größter Posten: Targeting (≈ 50 %).
7. **SPK5 Hash und Snapshot → Live-Bereich-Hash in JS.** Hash-Tick p95 ≤ 0,39 ms (kalt), warm ≤ 0,05 ms bei 2 ms
   Budget; kein Rolling-Hash, kein WASM-xxh3. Snapshot/Restore bleibt `memcpy` (0,02–0,03 ms für die 1,4-MB-Sim-Arena).
   Keyframes bleiben bis MS11 unkomprimiert im Speicher (deflate-raw 36–40:1 steht bei Bedarf bereit).
8. **SPK6 Latenz → `inputDelay = 0`, Render-Delay adaptiv ≈ ½ Tick, keine Client-Vorhersage.** Klick → erster
   bewegter Pixel p95 106–133 ms (alle Browser × SAB/Transfer, Pipeline bei naher Kamera), Klickmarker ≤ 1 Frame,
   seq-Bestätigung ≤ 1 Tick (+ ≤ 1 Anzeige-Frame). Offener Punkt für SPK2/MS3: Aus dem Stand wird die erste
   Bewegung in der Übersichtsansicht erst nach 220–270 ms sichtbar – das ist Beschleunigung/Drehen der Einheit
   (Tuning), nicht Transportlatenz.
9. **SPK2, SPK3, SPK4, SPK7 nicht in MS1:** SPK2 (Bewegungsgefühl) vor MS3, SPK3 (Pathing) in MS3 mit `nav`,
   SPK4 (Render-Last) in MS2 und nur mit GPU-Runner aussagekräftig (Punkt 5), SPK7 (KI-Loop) in MS6.
10. **Lint des Orchestrator-Skripts:** `.claude/eslint.config.js` schließt `.claude/workflows/*` vom Projekt-Lint aus
    (Workflow-Runtime-Globals); Root-`eslint.config.js` bleibt unverändert.

## Nachtrag 2026-09-29 – Nachbesserung nach dem MS1-Review

11. **SPK6-Latenz als Abweichung akzeptiert, kein Tick-Vorziehen.** In der Spielansicht (105 WU) wird die erste
    Bewegung erst nach p95 216–283 ms sichtbar, die seq-Bestätigung am Client liegt bei p95 ≈ 100–109 ms. Beides
    verfehlt die wörtlichen Kriterien (≤ 150 ms bzw. ≤ 100 ms) und steht in `docs/STATUS.md` als „teilweise erfüllt“.
    Transport und Takt sind ausgereizt: `cmd` wird immer im nächsten Tick angewandt (`cmdApplyTicksMax = 1`, gegated),
    der Frame direkt nach dem Tick publiziert. Einen Tick bei Befehlseingang vorzuziehen, würde den festen 10-Hz-Takt
    (Replay-, Speed- und späterer MP-Vertrag) brechen und wird verworfen. Die Spielansicht-Latenz ist Anfahrverhalten
    (3 WU/s² aus dem Stand) und wird mit SPK2/MS3 gelöst (Sofort-Drehung bzw. Anfahrprofil), nicht per Latenz-Hack
    in der MS1-Würfel-Sim.
12. **`SIM_BUILD` gehört der Sim und wird über die Goldens erzwungen.** Die Konstante liegt in
    `packages/sim/src/constants.ts` (`faf-sim/ms1.2`), `sim-host` re-exportiert sie. Jedes L2-Golden speichert den
    `simBuild`, mit dem es aufgenommen wurde (Format v2): Der Golden-Test verlangt `simBuild == SIM_BUILD`, und
    `goldens --update` verweigert eine geänderte Hash-Kette (oder geänderten Layout-/simHash) ohne neuen `SIM_BUILD`.
    Damit können Logs vor und nach einer Verhaltensänderung nie dieselbe simId tragen.
13. **Spalte `Units.gen` gestrichen (Abweichung von PLAN §3.5).** Die Generation steht bereits in der
    Generation-Spalte der Table-DSL (`units.gen`, Handles `index:20|gen:12`); eine zweite, nur beim Spawn kopierte
    Spalte wäre eine zweite, getrennt gehashte Wahrheit. Solange das Layout jung ist, wird sie entfernt (Layout-Hash
    `0xcc8737d2`).
14. **Der letzte Regel-Hash ist kein Regel-State.** `lastHash/lastHashTick` liegen in der eigenen Region `hashlog`
    mit `derived: true` (Snapshot und Voll-Hash ja, Regel-Hash nein). Hash-Kadenz (`HASH_INTERVAL_TICKS`, Release
    später 50) und Hash-Verfahren (Rolling/WASM) ändern damit den simulierten Zustand nicht; Debug- und Release-Builds
    teilen dieselben Regel-Hashes je Tick. Die World-Header-Wörter 2/3 bleiben reserviert (0).
15. **`seq` innerhalb einer Armee in Serial-Number-Ordnung.** CommandApply sortiert nach
    `(army, (seq − lastAckSeq − 1) & 0xffff, Ankunft)`; damit wirkt nach dem u16-Umlauf (65535 → 1, 0 wird vom Client
    übersprungen) der neuere Befehl zuletzt, und `lastAckSeq` bestätigt ihn (passt zu `seqAcked` im Client).
16. **Messung ≠ Gate.** Maschinenabhängige ms-Grenzen gaten nicht mehr den normalen Testlauf: Das Latenz-E2E gated
    nur Invarianten (Frames/Ticks), die ms-Gates laufen mit `FAF_LATENCY_GATE=1`. `pnpm bench` schreibt nur lokale,
    git-ignorierte Berichte (`results/*.json`); die Tabellen in `docs/status/P6-headless.md` ändert nur
    `pnpm bench -- --update-docs`. STATUS nennt Wertebereiche über mehrere Läufe statt Einzelwerte.
