# TRACK-AI tai-p2: Arena-Welt

Stand 2026-09-29, kanonischer Ordner `flow-and-fire`, Branch `main`.

`ArenaWorld` implementiert eigene Float-Positionen, stabile Handles mit Generationen, A*-Pfade ohne Eckenschneiden, Bau-/Assist-/Guard-/Repair-Aufträge, FactoryQueue/Repeat/Rally mit Roll-off, Upgrades und abstrakten Sofortschaden. Einkommen, Upkeep, Bedarf und Fortschritt gehen durch `FlowEconomy`. Die Arena lädt reale `.rtsmap`-Dateien und die unveränderte Roster-Tabelle.

Die Sicht wird je Army berechnet. Feindliche mobile Einheiten verlassen die Perception beim Sichtverlust; Strukturen bleiben als Ghosts. Zielerfassung erfordert Sicht. Ein Attack-Auftrag verfolgt im Fog den letzten bekannten Ort, keine verborgenen aktuellen Koordinaten. Assist/Repair verlangen eigene Ziele; Angriff verlangt bekannte feindliche Ziele. Overcharge verlangt Sicht, Reichweite und eigenen Energiespeicher.

API: `ArenaWorld.create`, `spawn`, `kill`, `addIncome`, `addDemand`, `setStorage`, `blockCells`, `apply`, `step`, `hash`, `staticFor`; `writePerception`; `runMatch`, `runMatchAsync`, `replayMatch`. Asynchrone Resultate werden vor Anwendung und Aufzeichnung nach Army/Sequenz sortiert. Worker-Antwortreihenfolge beeinflusst den Command-Log daher nicht.

Belege: vier Welt-Tests, darunter AI-PERC-01/02; Integration mit Hash-Replay; AI-DET-01 vergleicht 6000 Ticks synchron/Node-Worker, Command-Bytes sowie Welt-Hashes alle 600 Ticks. Diese Arena ersetzt keine echte Sim: keine Projektile, Kollisionsauflösung, Wracks/Reclaim oder Radar. Cheats gehören zum Szenario-Setup und müssen beim Nachspielen wieder angewandt werden; der reine Command-Log enthält sie nicht.
