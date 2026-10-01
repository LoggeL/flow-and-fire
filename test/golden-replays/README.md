# Golden replays

Die neun Szenarien aus `tools/headless/goldens/` liegen als dauerhafte FAFL-Kommandologs unter
`logs/` und als portable `.rtsreplay`-Dateien in diesem Ordner. Die Replays enthalten die
aufgezeichneten Befehle, Regel-Hashes und Sub-Hashes der aktuellen MS6-Simulation
(`faf-sim/ms6.1-upgrades`, FAFL v4). Diese Sandbox-Replays verwenden GAME v1; vollständige
Skirmish-Setups werden in GAME v3 gespeichert und separat geprüft. Die
Szenario-Karten werden über `scenarioByName` aufgelöst, einschließlich der generierten
Engstellen- und Hinderniskarten.

Nach einer Änderung an den Sim-Regeln und dem zugehörigen `SIM_BUILD` werden die Dateien
im Projektstamm in dieser Reihenfolge erneuert:

```sh
./tools/heavy pnpm --filter @faf/headless goldens -- --update
./tools/heavy pnpm --filter @faf/headless golden-logs -- --update
./tools/heavy pnpm --filter @faf/headless replay-goldens -- --update
```

Ohne `--update` prüfen dieselben Befehle die Frische. Der Replay-Generator schreibt eine
Datei nur nach erfolgreicher Nachsimulation ohne Hash-Abweichung und Abgleich der gesamten
Hash-Kette sowie des abschließenden Regel- und Voll-Hashes mit dem JSON-Golden.

Die Dateien sind Testpartien mit Cheat-Spawns und deshalb als `Tainted` markiert. Das ist
vom deterministischen Abspielen unabhängig. Diese Goldens prüfen die Replay-Engine und die
portablen Dateien. Die Bedienung des Replay-Browsers im Spiel braucht zusätzlich Browser-QA.
