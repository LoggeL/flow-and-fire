# Golden-Replays

Eingecheckte `.rtsreplay`-Dateien (Format: PLAN §3.11, `packages/formats/src/rtsreplay/`) aller L2-Goldens. Sie sind
die Referenz-Replays für PLAN §5.2 MS11 („Golden-Replays in CI“): jede Datei muss mit dem aktuellen Sim-Build
bitgleich abspielbar sein – in Node und in Chromium, Firefox und WebKit (Worker), inklusive Rückwärts-Seek.

## Inhalt

| Datei | Herkunft |
|---|---|
| `logs/<szenario>.faflog` | FAFL-v2-Command-Log des L2-Szenarios (TRACK-REPLAY p3, Script `golden-logs`) |
| `<szenario>.rtsreplay` | daraus konvertiertes Replay (TRACK-REPLAY p6, Script `replay-goldens`) |

Szenarien: `cubes-1000-move`, `cubes-churn` (Testebene 512 WU), `ridge-1000-move`, `ridge-water-block` (hollow-ridge),
`setons-bridge-move` (Setons). Liste im Code: `GOLDEN_REPLAY_SCENARIOS` in
`tools/headless/src/replay/xengine-job.ts`; der Harness-Worker (`tools/headless/src/harness/worker-entry.ts`,
`REPLAY_URLS`) spiegelt sie als statische Vite-Assets.

Die Konvertierung (`convertGoldenLog`) ist festgelegt: `convertCommandLog` aus `@faf/sim-host` mit der Karte laut
Golden-JSON (`tools/headless/goldens/<szenario>.json`, Feld `map`: `testplane:<Größe>` oder Repo-Pfad der `.rtsmap`),
`content/generated/sim.bin`, Sub-Hashes alle 100 Ticks, `META.extra = {scenario, map, source}`, Standard-Armeenamen
„Army 1“, „Army 2“ … Das Replay ist durch die Cheat-Spawns der Szenarien getaintet (erwartet), `Complete`, nicht
`Truncated`, buildHash `golden`.

## Prüfungen

- `pnpm --filter @faf/headless replay-goldens` – konvertiert jedes Golden-Log frisch und vergleicht bytegleich mit der
  eingecheckten Datei; prüft außerdem HEAD.simBuild == SIM_BUILD, HASH-Trail == Golden-Trail und Wiedergabe mit
  0 Divergenzen und den End-Hashes des Golden-JSON. Fehlt/abweichend → Exit 1.
- `tools/headless/test/replay-goldens.test.ts` (vitest) – dieselben Prüfungen plus `rewriteRtsReplay` bytegleich und
  Rückwärts-Seek auf Tick 1.000 nach `playToEnd` (Voll-Hash == Direktlauf).
- `pnpm test:xengine` – spielt jedes Golden-Replay in Node (frischer Prozess) und in Chromium/Firefox/WebKit-Workern
  ab (kalt, 3 Aufwärmläufe, warm); Trail == HASH-Chunk == Golden, End-Hashes == Golden, Voll-Hash nach Rückwärts-Seek
  auf die Mitte == erster Durchlauf. Inflate läuft überall über fflate (gleicher Codepfad).

## Regenerierung

Die Replays hängen am SIM_BUILD (HEAD.simBuild, simId). Nach einem SIM_BUILD-Bump (z. B. beim Merge von MS3) in dieser
Reihenfolge neu erzeugen und alle drei Ergebnisse gemeinsam einchecken:

```sh
pnpm --filter @faf/headless goldens -- --update        # Golden-JSON (Hash-Ketten)
pnpm --filter @faf/headless golden-logs -- --update    # test/golden-replays/logs/*.faflog
pnpm --filter @faf/headless replay-goldens -- --update # test/golden-replays/*.rtsreplay
```

`replay-goldens -- --update` schreibt nur, wenn die Konvertierung verifiziert ist (jeder aufgezeichnete Hash
nachsimuliert, 0 Mismatches), Trail und End-Hashes dem Golden-JSON entsprechen und HEAD.simBuild == SIM_BUILD ist.
Auch eine neue fflate-Version kann die Bytes ändern (CMDS-Blöcke sind deflate-raw) – dann meldet die Frische-Prüfung
eine Abweichung, die Wiedergabe bleibt korrekt; neu erzeugen.

Ein neues L2-Golden braucht zusätzlich einen Eintrag in `GOLDEN_REPLAY_SCENARIOS` und in `REPLAY_URLS` (der Test prüft
beides).

## Bezug zu MS11

PLAN §5.2 MS11 verlangt Golden-Replays in CI – diese Dateien sind der Grundstock. Replays eines älteren Builds sollen
später über `/b/<buildHash>/` mit dem passenden Build abgespielt werden (`ReplayCompatError.redirect`); diese
Wiedergabe folgt mit apps/game (Replay-Viewer, MS11). Bis dahin werden die Golden-Replays bei jedem SIM_BUILD-Bump neu
erzeugt statt archiviert.
