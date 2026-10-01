# Goal: spielbares Flow & Fire veröffentlichen und gezielt verbessern

## Aktuelle Ausrichtung (1. Oktober)

Der nächste überprüfbare Abschluss ist ein laufender Docker-Container auf der HomeBox,
ein öffentliches GitHub-Repository und eine README mit Start, Bedienung und aktuellem Stand.
Commit, Push und diese Veröffentlichung sind ausdrücklich beauftragt.
Danach werden konkrete sichtbare Spielprobleme jeweils vollständig umgesetzt und im
tatsächlichen Spiel geprüft. Bestehende Integrationen bleiben die Grundlage.

Weitere Messungen brauchen eine konkrete Änderung oder einen reproduzierten Fehler.
Unveränderte Kandidaten werden nicht erneut getestet. Die noch offenen ursprünglichen
Zeitziele bleiben dokumentiert und gelten nicht als bestanden; sie blockieren die
Veröffentlichung der spielbaren Entwicklungsversion nicht. Für einen Schritt werden nur
die betroffenen Funktionen und erforderlichen gemeinsamen Schnittstellen geprüft.

Vorhandene Sol-Agents werden für klar getrennte Umsetzungen wiederverwendet. Es gibt
keine neue Fanout-Runde und keine Wiederholung bereits abgeschlossener Inventuren.
ImageGen wird für eine tatsächlich fehlende Grafik verwendet. Favicon und beide
ACU-Upgradeicons sind bereits erzeugt und integriert; das aktuelle Inventar ist leer.
Automatisierte Browserprüfungen bleiben ohne Lautsprecherausgabe.

Stand 2026-10-01. Dieses Goal führt die im Konsolidierungsbericht offenen Punkte weiter.
Die vorhandenen eigenständigen Pakete werden an echte Sim-Zustände, Commands und Ereignisse
angeschlossen. Eine Demo-Anbindung gilt nicht als fertige Spielintegration.

## Reihenfolge und Abhängigkeiten

| Paket | Umsetzung | Abschlussbeleg |
|---|---|---|
| 1 | Aktueller Spielstart, Assets und Worker | Tatsächlicher Browserstart auf Setons, Auswahl, Bewegung und Pause ohne Laufzeit-/Fetch-Fehler |
| 2 | Flow-Wirtschaft und Basisbau | Integer-Abrechnung, Ressourcen/Stall, ACU/Mex/Pgen, gemeinsame Platzierungsregeln, Bau-Commands und echte Frame-Daten |
| 3 | Benötigte Kampf-/Sicht-/Bau-Verbraucher | Echte Sim-Projektile, Schaden/Match-Ende, Ereignisse, Fabrik/Assist und Queue-Verträge statt Arena-Ersatz |
| 4 | HUD und Menüs | Ressourcen, Mehrfachauswahl, Kartenaktionen, Queues und Menüs über reale Daten/Commands; DE/EN und Hotbuild. Minimap und Porträts entfallen auf Nutzerwunsch |
| 5 | KI im Spiel | Gefilterte Perception, echte Sim-Commands, tick-synchroner Browser-Worker, Recorder-/Timeout-Verträge und deterministischer Wiedergabenachweis |
| 6 | Audio im Spiel | Reale Event-Zuordnung und Klickbestätigung; Stimmen-/Zeitbudget; automatisierte Ausgabe ausschließlich ohne Lautsprecherverbindung |
| 7 | FX im Spiel | Kampfereignisse, Render-Passes, Context-Restore und Sichtfilter; Render-/Draw-/Zeitbelege |
| 8 | Replay im Browser | Import/Export/Bibliothek, Player/Seek, Kompatibilitätsroute und tatsächliche OPFS-Wiederherstellung nach Tab-Abbruch |
| 9 | Verfehlte lokale Zeitziele | Unveränderte Last/Grenzen für Pathing, Klicklatenz und FX-GPU-Zeiten nach bestätigten Korrekturen einzeln messen |
| 10 | Gemeinsame Abnahme | Typecheck, Paketgrenzen, relevante Units/Properties, Builds/Assets, aktuelle Goldens/Cross-Engine und stumme Browser-Endabläufe |
| 11 | Benötigte Grafiken mit ImageGen (ausdrücklich beauftragt) | Generierte Projektassets mit Prompt/Herkunft, echter Runtime-Anbindung und visueller Prüfung in der finalen Größe; aktuelles Inventar: Favicon und zwei ACU-Upgradeicons |

Die zehn ursprünglichen GPT-6.1-Sol-Arbeitspakete und der ausdrücklich ergänzte
ImageGen-Schritt laufen in Wellen mit höchstens drei aktiven Subagents neben dem Root. Simulation, Protokoll und Blueprint-Verträge werden zuerst festgelegt; abhängige
Adapter folgen danach. Messfenster werden exklusiv vergeben. Große Prüfungen verwenden
`tools/heavy`, höchstens vier Vitest-Worker und einen Playwright-Worker.

## Aktueller Arbeitsstand

Das Goal ist aktiv. Die Wirtschaft/Bau-, KI-, Audio-, FX- und Replay-Adapter liegen im gemeinsamen Spielcode. Kampf, Sicht, Produktion und Match-Ende haben neue deterministische Verträge. Der echte Browser startet ein Gefecht; Auswahl, Bewegung, Kampf-FX, Schatten und WebGL-Wiederherstellung wurden funktional geprüft. Das HUD bindet Fabrikqueues, Befehle und die vorhandenen Blueprint-IDs an die Design-Rollen an. Der zuvor qualifizierte kompakte FA-Build `b411bee7eaa2-de4fd6c56` bestand alle 21 damaligen Browserfälle auf Chromium, Firefox und WebKit. Die nachfolgenden Bedienungs-/Upgrade-Ergänzungen haben eigene aktuelle Belege. Eine aktuelle Brave-Abnahme wird daraus nicht abgeleitet. Die Einstellungen steuern die tatsächlichen Audio-/FX-/Render-/Frame-Cap-Verbraucher, die Hintergrundpause und die persistente Replay-Aufzeichnung.

Die gemeinsame Prüfung läuft. Der erste Gesamtlauf hat 2926 von 2999 Tests bestanden. Die zuvor für `faf-sim/ms6.0` qualifizierten 27 Golden-Artefakte sind gesichert. Die aktuellen JSON-Goldens, FAFL-Logs und portablen Replays wurden für `faf-sim/ms6.1-upgrades` erneuert. Alle Szenario-Assertions, 60 unabhängigen Frische-/Hash-/Seek-Tests und die zusätzliche Node-Replayprüfung bestehen. Die aktuelle Cross-Engine-Prüfung bestätigt alle 180 Hash-Ketten und 180 Replay-Läufe ohne Abweichung; die strikten PathService-Zeitgrenzen bleiben auf vier kalten Node-/Browserfällen verfehlt. Historische MS1/MS2-Artefakte bleiben unverändert. Typechecks, ESLint und Paketgrenzen bestanden vor den letzten Lifecycle-/ACK-Ergänzungen. 31 fokussierte Lifecycle-/Host-/HUD-Tests bestätigen den geordneten OPFS-Abschluss und die erst nach Anwendung gesendete Command-Bestätigung. Der erste MS6.1-Gesamtlauf R1 bestand 3219 von 3223 Tests in 315 von 318 Dateien. Die vier Fehler betreffen veraltete ACU-Roster-/Modell-Fixtures; alle 36 fokussierten Tests bestehen nach deren Korrektur. Weitere 79 aktuelle Kontext-/KI-/Input-Tests und der echte Million-Command-Queue-Test bestehen.

Der vollständige Repository-Lauf R2 besteht inzwischen alle 3263 Tests in 323 Dateien, Exit 0, mit `./tools/heavy pnpm test --maxWorkers=4` in 318,95 Sekunden. Der genaue Job und sein vollständiges Log liegen unter `.git/integration-goal/jobs/goal-ms61-full-suite-r2.{json,log}`. Die native Kontextmatrix und die strikte KI-Abnahme bleiben davon getrennt offen. Typecheck R8 besteht nach den geprüften HTTP-/Kontext-Fixture-Korrekturen. Lint R5 besteht ESLint und Paketgrenzen mit 1325 Modulen und 4982 Abhängigkeiten; der davor gescheiterte R4-Lauf mit generierten AI-Dist-Dateien und einer leeren Fixture-Destrukturierung bleibt erhalten. Die separate serielle Host-Allokationsnachprüfung nach der Cleanup-ACK-Änderung besteht beide ursprünglichen Fälle: 554,0 KiB auf Testplane und 992,9 KiB auf Hollow Ridge, jeweils 10.000 warme Ticks mit 1000 Einheiten, 20 von 20 GC-freien Blöcken und null GCs. Beleg: `.git/integration-goal/ms61-integration-20261001-r1/host-allocation-r2-qualification.json`. Belege: `.git/integration-goal/jobs/goal-ms61-common-typecheck-r8.json` und `.git/integration-goal/jobs/goal-ms61-common-lint-r5.{json,log}`.

Die früheren unveränderten Allocation-Gates bestehen für die reine Sim auf Testplane (441,9 KiB) und Hollow Ridge (539,0 KiB) sowie den Host auf Testplane (470,4 KiB) und Hollow Ridge (556,7 KiB). Beide Host-Fälle hatten 20 von 20 GC-freie Messblöcke und keine GCs. Veraltete numerische Blueprint-Indizes im Ridge-Sim-Fixture wurden auf die tatsächlich ursprünglichen T1-/T2-/T3-Tanks korrigiert. Eine im Vitest-Hotpath gemessene Closure-Allokation in matchResult wurde durch einen skalaren Match-End-Prädikatpfad und eine erst nach Spielende ausgeführte Schleife entfernt. Nach Unterbrechung des ersten Laufs wurde Ridge separat vollständig nachgeprüft; dies ist kein neuer gemeinsamer Gesamtsuite-Lauf. Belege: combat-alloc-recheck.log, combat-host-alloc-final.log und jobs/host-ridge-final.log unter .git/integration-goal. Die aktuelle serielle MS6.1-Nachprüfung besteht inzwischen alle fünf Allocation-Tests: Sim auf Testplane 540,9 KiB und Hollow Ridge 527,0 KiB, Host auf Testplane 553,0 KiB und Hollow Ridge 966,5 KiB über jeweils 10.000 warme Ticks. Die Host-Messungen enthalten 20 von 20 GC-freie Blöcke; die getrennte Keyframe-ArrayBuffer-Zunahme bleibt im Rohbeleg ausgewiesen. Lokale Zeitmessungen bleiben offen; die separate serielle Host-Allokationsnachprüfung nach der Cleanup-ACK-Änderung besteht beide Fälle; der aktuelle vollständige Repository-Lauf R2 ist bestanden. Die sechs aktuellen Browser-Endablauf-Specs sind mit R6 vollständig bestanden.

Der echte OPFS-Tab-Abbruch ist mit R2 abgeschlossen: 300 Cubes liefen 600,010 Sekunden bei 1x ohne Pause, Tick 1 bis 6001. Nach dem Chromium-Renderer-Absturz enthält das tatsächliche OPFS-Log keinen END-Datensatz und persistierte bis Tick 6000. Die native Replay-Bibliothek exportiert diese Teilaufnahme. Eine unabhängige Node-Simulation bestätigt alle 600 vollen Hashes und 60 Tabellenprüfpunkte über 18 Regionen ohne Abweichung. Die ursprüngliche Cube-Erzeugung setzt erwartungsgemäß das Cheat-/Tainted-Merkmal. Original- und Ersatzseite hatten die strikte stumme Ausgabe installiert; es gab keine Lautsprecherverbindung oder Host-/Seitenfehler. Der genaue Beleg liegt in `.git/integration-goal/opfs-tabkill-20260930-165248-r2/r2/summary.json`. Der davor gescheiterte R1-Versuch bleibt getrennt archiviert. Der Wechsel aus Build `b411bee7eaa2-dd7dd8d92` in den echten gespeicherten Build `b411bee7eaa2-d97fa2eeb` besteht inzwischen auf Chromium, Firefox und WebKit. Die originalen 1892 Replay-Bytes und der archivierte Entry-SHA stimmen überein. Vier HASH-Seeks und 700 kontinuierlich abgespielte Ticks ergeben 9,919x, 9,926x und 9,898x ohne Fehler oder Hash-Abweichung. Die separate Audio-Abnahme im selben historischen R1-Lauf scheiterte an 96 nicht zugeordneten Artillerieereignissen pro Engine. Die korrigierte Zuordnung ist inzwischen mit allen drei aktuellen Audiofällen im Build `b411bee7eaa2-d1d202021` bestanden; der frühere Fehlerbeleg bleibt erhalten. Der vollständige getrennte Beleg liegt in `.git/integration-goal/replay-audio-native-20261001-r1/qualification.json`.

Ein neuer echter Queue-Stresstest besteht eine Million Command-Envelopes in 15.625 vollständigen World-Ticks. Eine unabhängige Array-Oracle prüft jede Queue nach jedem Tick; echte Produktionsstarts, Abrechnung, Abschlussereignisse und Repeat bleiben aktiv. Der Lauf enthält 75 fertige Produkte und zehn Repeat-Abschlüsse sowie ungültige Eingaben und Ressourcen-Stalls. Er ersetzt die noch offene native Rechtsklick-Kontextmatrix nicht. Beleg: `.git/integration-goal/ms61-integration-20261001-r1/queue-allocation-qualification.json`.

Der maschinenlesbare Arbeitsstand liegt lokal in `.git/integration-goal/work-packages.json`.
Der ergänzende UI-Auftrag vom 30. September umfasst eine minimale ImageGen-Bearbeitung
eines echten Forged-Alliance-Screenshots, die entsprechende kompakte Spieloberfläche,
artikulierte Kampfgelenke und native beziehungsweise virtuelle Spielcursors. Die neue
Vorlage verzichtet auf Minimap und Einheitenbilder. Der aktuelle gemeinsame Build besteht
Source-/Test-Typechecks, Lint, Paketgrenzen und 85 gezielte Tests. Die an der Originalvorlage
ausgerichtete Oberfläche besteht alle 21 Browserfälle auf drei Engines ohne übersprungene
Fälle. Der genaue Belegstand liegt in
`docs/status/game-ui-rigs-cursors.md`. Diese Ergänzung ersetzt die noch offenen
Zeit- und gemeinsamen Abschlussprüfungen nicht.
Die sieben Originalarchive, vorhandene Karten und vorherige Abnahmebelege bleiben erhalten.
Sim-/Layout-/Blueprint-Identitäten werden bei notwendigen Vertragsänderungen ausdrücklich
versioniert. Aktualisierte Goldens und Assets entstehen nach einem zusammenhängenden
Integrationsschritt; historische MS1-/MS2-Belege werden nicht überschrieben.

## Ergänzung: Bedienung, Sicht und benötigte Grafiken

Der aktuelle Auftrag ergänzt Shift-Ziehen für mehrere echte Bauaufträge, Laufanimationen
an den vorhandenen ACU-Hüftgelenken, vorab sichtbares Kartengelände mit dunklen Zellen
außerhalb der aktuellen Sicht, lesbare Einheiten-/Gebäudeicons, größere Bauziele ohne
durchgestrichene Beschriftungen, echte bezahlte ACU-Eigenupgrades und kompakte Meldungen.
Ein Favicon gehört ebenfalls zu diesem Schritt. Diese Arbeiten laufen vor den noch offenen
Zeit- und Gesamtabnahmen.

ImageGen ist ein ausdrücklicher Arbeitsschritt dieses Goals. Für alle noch benötigten
Rastergrafiken und Icons wird der [ImageGen-Skill](/Users/logge/.codex/skills/.system/imagegen/SKILL.md)
mit dem eingebauten Bildwerkzeug verwendet. Das aktuelle Inventar umfasst das Favicon,
Engineering- und Panzerungsicons für die neuen ACU-Upgrades sowie alle bei der visuellen
Abnahme zusätzlich erforderlichen Grafiken. Vorhandene editierbare Strategie-Glyphen
bleiben die Grundlage der Einheiten-/Gebäudekennzeichnung. Neue Assets werden im
gemeinsamen Projekt gespeichert, mit Prompt und Herkunft dokumentiert, im tatsächlichen
Spiel angeschlossen und in ihrer finalen kleinen Darstellung geprüft. Eine generierte
Vorschau allein gilt nicht als Integration. Zusätzliche dekorative Panels oder Bilder
ohne Bedienzweck werden nicht ergänzt.

Das Favicon und die beiden ACU-Upgradeicons sind mit dem eingebauten Bildwerkzeug
erzeugt, im Projekt gespeichert und in den tatsächlichen Runtime-Code eingebunden.
Prompts und Originale stehen in `docs/design/ui-assets/imagegen-manifest.json`.
Die vollständige Runtime-Inventur bestätigt Strategie-Glyphen für alle 14 kompilierten
Einheitentypen. Implementierung und Abnahmebelege dieses Schritts stehen in
`docs/status/game-ui-building-fog-upgrades.md`; die echte Browserprüfung bleibt ein
eigener Nachweis neben der Bilderzeugung.

Der neue Build `b411bee7eaa2-dd7dd8d92` besteht alle 24 Browserfälle dieses Schritts
auf Chromium, Firefox und WebKit ohne übersprungene oder wiederholte Fälle. Die
Prüfung bestätigt echte Bauaufträge, Abbruch, ACU-Lauf-/Ruhepose, bezahlte Upgrades,
beide Icongrößen, Zellsicht mit beiden Transporten und kompakte Layouts. Alle Seiten
haben die strikte stumme Audioanbindung vor der Navigation installiert. Typechecks,
Lint, Paketgrenzen und die fokussierten Tests sind ebenfalls bestanden. Der Beleg
liegt in `.git/integration-goal/ui-extensions-20260930/native-r5/qualification.json`.
Dieser ausdrücklich erforderliche ImageGen-Schritt ist für das aktuelle Inventar abgeschlossen: drei generierte Rasterassets, Strategie-Glyphen für alle 14 kompilierten Einheiten-/Gebäudetypen und 21 vorhandene Cursorzustände sind angeschlossen. Die erneute aktuelle Abnahme bestätigt alle 24 UI-Fälle im Build `b411bee7eaa2-d1d202021`; die drei stummen Audiofälle haben einen getrennten aktuellen Nachweis. Für jede zusätzlich tatsächlich fehlende Grafik in den übrigen Goal-Arbeiten bleibt ImageGen mit Projektablage, Herkunft, Runtime-Anbindung und finaler Größenprüfung verpflichtend. Die restlichen ursprünglichen Goal-Gates bleiben offen.

Der ImageGen-Skill ist zusätzlich im maschinenlesbaren Goal mit Inventur, Bilderzeugung, Projektablage, Runtime-Anbindung und Prüfung der finalen Anzeigegröße hinterlegt. Die aktuelle HTTP-Prüfung bestätigt das Favicon und beide ACU-Upgradeicons als exakte Projektbytes im laufenden Build `b411bee7eaa2-d1d202021`. Der Beleg liegt in `.git/integration-goal/imagegen-step11-confirmation-20261001-r1/qualification.json`; er ergänzt die vorhandene stumme Browserabnahme und ist kein neuer Browserlauf.

Die aktuelle gemeinsame Build- und Assetprüfung besteht für `b411bee7eaa2-d1d202021`.
Alle 24 UI-Fälle und die drei stummen Audiofälle sind in diesem Build geprüft.
Die aktuelle Kontextmatrix R6 besteht zusätzlich alle sechs Engine-/Transportfälle.
Die früheren Fehler des 39-Fälle-Laufs und der Kontext-Fixtures bleiben in ihren
ursprünglichen Belegen erhalten. Die ursprünglichen Literal-Latenzgates bleiben
noch offen; ihre Abnahme wird getrennt von UI, Audio und Kontextbefehlen geführt.

Die Karte wird ausschließlich in der Darstellung vorab als erkundetes Gelände gezeigt.
Die autoritativen Sichtfilter für Gegner, Ereignisse und Wiedergaben bleiben wirksam.
Die neuen ACU-Verbesserungen werden erst nach tatsächlicher Ressourcenabrechnung und
vollständigem Fortschritt auf denselben Einheitenhandle angewendet.

Dieser Schritt führt `faf-sim/ms6.1-upgrades` ein. Die zuvor qualifizierten MS6.0-Goldens
sind mit einem geprüften 65-Dateien-Manifest gesichert. Die 27 aktuellen Artefakte und
die Node-Nachprüfungen bestehen für die neue Sim-Identität. Der genaue Beleg liegt in
`.git/integration-goal/ms61-goldens-20261001/qualification.json`; Die funktionale Cross-Engine-Gleichheit ist ebenfalls belegt;
der strikte Pathing-Zeitbeleg und die noch offenen nativen beziehungsweise lokalen Abschlussgates bleiben offen. Der vollständige aktuelle Repository-Lauf R2 besteht 3263 Tests in 323 Dateien. Historische MS1/MS2-Belege werden
dadurch nicht als aktuelle Abnahme ausgegeben.

Die aktuellen lokalen Zeitabnahmen bleiben offen. Der vollständige Literal-SPK6-Lauf im gespeicherten Build `b411bee7eaa2-dd7dd8d92` verfehlt auf allen sechs Engine-/Transportfällen die Startansicht-Grenze: 234,08 bis 252,88 ms statt höchstens 150 ms. Vier Fälle verfehlen außerdem mindestens eine 100-ms-ACK-Phase. Eine rein visuelle erste Bewegungsprognose ist entsprechend der im Plan vorgesehenen SPK6-Entscheidung integriert und wird geprüft. Sie bleibt auf vollständige eigene Bodeneinheiten, 200 ms und einen halben WU beschränkt; angenommene Sim-Frames und Commands bleiben unverändert. Die ACK-Bestätigung folgt jetzt der letzten autoritativen Cleanup-Phase vor der abgeleiteten Hash-Aufzeichnung. Alle 21 fokussierten Host-/ACK-Tests bestehen, einschließlich Arena-, Replay- und Hash-Parität. Die aktuelle native Nachmessung enthält Startbewegungs-p95-Werte von 43,3 bis 58,76 ms, scheitert aber weiterhin an fehlenden Move-Samples in fünf Fällen und den ursprünglichen ACK-Grenzen. Die separate aktuelle Host-Allokationsprüfung besteht beide Fälle. Es liegt keine bestandene ursprüngliche Literal-Zeitabnahme vor. Kontextbefehle erfordern ein dokumentiertes Clear-Ground-Fixture, damit reale Rechtsklicks nicht versehentlich Guard auslösen. Die abgeschlossene EVENT-Diagnose enthält alle 636 nativen Rechtsklicks. Alle 42 Fälle ohne Move-Sample sind anhand der tatsächlichen geposteten Command-Bytes als Guard nachgewiesen. Es gibt dabei keine fehlenden Event-Zuordnungen, Decode-Fehler oder Überläufe. Die Diagnose enthält messbare Beobachterkosten und ersetzt keine ursprüngliche Zeitabnahme. Ihre Beobachter sind entfernt und der ursprüngliche Testquellstand ist geprüft wiederhergestellt. Die ursprünglichen fehlgeschlagenen Messungen bleiben unter `.git/integration-goal/literal-latency-20261001-r1/current/qualification.json` erhalten.

Die vollständige native KI-Matrix R2 besteht elf von zwölf ursprünglichen Fällen, ohne übersprungene Fälle, Retries oder gelockerte Lasten und Grenzwerte. Der echte Normal-Scheduler, alle Inline-Routen und die 6000-Tick-Gleichheit mit Node bestehen auf Chromium, Firefox und WebKit. Auch Hard mit zweimal 300 Einheiten bestätigt überall Operationsbudgets, keine Abbrüche, exakte Eingabebytes einschließlich leerer Batches, alle Hash-Punkte und die finalen Zustände. Nur der ursprüngliche Chromium-Timingvergleich scheitert: AI-p95 9,48 ms gegenüber 9,26 ms ohne AI, also +2,3758 Prozent statt höchstens zwei Prozent. Firefox und WebKit bestehen diesen Vergleich. Die Gesamt-KI-Zeitabnahme bleibt offen. Der Beleg liegt in `.git/integration-goal/ai-native-20261001-r2/qualification.json`.

Der R2-Harness verwendet echte eingefrorene HTTP-Ressourcen und die vorhandene ReplaySource für das vollständige aufgezeichnete Eingabelog. Drei fokussierte Prüfungen bestätigen Command-, Arena-, Hash- und Loggleichheit. Typecheck R9 und Lint R6 bestehen. Alle 203 Quellidentitäten sowie die unveränderten AI-Child-Worker-Bytes sind im abgeschlossenen nativen Lauf geprüft. Eine separate, opt-in aktivierte Diagnose kopiert jetzt die vorhandenen Phasenmessungen pro erfolgreichem Tick, um den Timingfehler zu lokalisieren; sie ersetzt keine ursprüngliche Abnahme.

Die vier initialen Klickfehler von Kontext R3 sind durch DOM-Snapshots und Screencasts auf den Ladebildschirm bei 95 Prozent zurückgeführt. Nach der Bereitschaftskorrektur bestehen in R4 beide Chromium- und Firefox-Transporte. Die zwei verbliebenen WebKit-Fälle werden getrennt untersucht: Replay-Bereitschaft mit unverändertem tatsächlichen Klickempfänger sowie echte Kampfschäden vor der Reparatur. Die ursprüngliche 100-Tick-Grenze und die echte HP-Prüfung bleiben aktiv.

Die separate KI-Phasendiagnose enthält alle 600 Tick-Zeilen je Strecke und Engine mit identischen Commands und Hashes. Sie besteht Chromium und Firefox, verfehlt aber in WebKit die absolute Zwei-Prozent-Grenze mit -4,9315 Prozent, weil dort die No-AI-Strecke langsamer ist. Die gemessenen Unterschiede liegen dort vor allem in Weapons und Intel. Daraus wird keine CPU-Ursache und keine neue Abnahme abgeleitet. Die Diagnose ist vollständig zurückgebaut; der ursprüngliche R2-Harness und seine kompilierten Bytes sind geprüft wiederhergestellt. Beleg: `.git/integration-goal/ai-phase-row-diagnostic-20261001/completed-analysis-readout.md`.

Auch der HPA-Local-Capture-Trial ist nach vollständiger Parität und 30 fokussierten Tests verworfen: Chromium 1024 kalt 5,805 ms und Firefox 5,28 ms verfehlen die unveränderte 5-ms-Grenze. Die vier anderen nativen Fälle bestehen. Originalquelle und neu gebauter Baseline-Harness sind wiederhergestellt; alle sechs Rohserien und der Kandidatenbuild bleiben erhalten. Beleg: `.git/integration-goal/nav-local-capture-preparation-20261001/qualification-r1.json`.

Die aktuelle vollständige FX-Nachmessung bleibt bei 20 Schilden und zwei 2048²-Schattenkaskaden auf Chromium über den ursprünglichen GPU-Grenzen. Firefox und WebKit liefern weiterhin keine GPU-Zeitwerte. Eine Shader-Arithmetikänderung und ein diagnostischer Versuch mit weniger Query-Grenzen halfen nicht; beide Quellstände sind vollständig zurückgesetzt und ihre Ergebnisse separat erhalten. Auch der zweite aktuelle Navigationstrial bestand exakte Arena-/Pfadparität und 30 fokussierte Tests, verfehlte jedoch die strikten 1024-WU-Grenzen auf allen drei Browserengines. Originalquelle und Harness sind wiederhergestellt. Diese Versuche sind keine bestandene Zeitabnahme.

Die native Kaltfenster-Diagnose hält alle 270 Service-Fenster des vollständigen Sechs-Fälle-Laufs fest. Der erste gemessene Aufruf bei Tick 2 ist in diesem Lauf jeweils das Maximum. Chromium 1024 erreicht 5,615 ms und Firefox 5,16 ms; beide verfehlen die unveränderte 5-ms-Grenze. Die ursprünglichen Quellen und alle 17 kompilierten Harness-Dateien sind exakt wiederhergestellt. Ein Profil mit tatsächlich zugeordneten Worker-Stacks steht noch aus. Beleg: `.git/integration-goal/nav-cold-attribution-preparation-20261001/native-r1/completed-analysis/readout.md`.

Der getrennte native Schildvergleich enthält 144 echte Renderpaare auf drei Engines. Alle 72 RGBA8-Paare sind pixelgenau gleich. Vier HDR-Paare verfehlen die Nulltoleranz mit zusammen 18 unterschiedlichen Pixeln und einem maximalen Kanalunterschied von 0,00048828125. Alle nativen Hintergrund-Clears stimmen überein, jede Ausgabe enthält tatsächlich gezeichnete Pixel und es gibt keine Audio-, Shader- oder GL-Fehler. Die ursprüngliche Shaderquelle bleibt unverändert. Der Vergleich belegt keine GPU-Zeitabnahme. Beleg: `.git/integration-goal/fx-instance-shading-preparation-20261001/native-parity/runs/native-r3/qualification.json`.

Die aktuelle Kontextabnahme R6 besteht alle sechs Fälle auf Chromium, Firefox und WebKit mit SAB und Transfer, ohne Retries oder übersprungene Fälle. Der Aufbau öffnet die tatsächliche Details-Aufklappung und bestätigt die nativen Hold-/Free-Fire-Änderungen über angenommene Watch-Daten. Dieselben ursprünglichen Akteure und der echte Schaden innerhalb der 100-Tick-Grenze bleiben erhalten. Attack, Move, Guard, bezahlter Assist-Fortschritt, Repair, Reclaim, Fabrik-Rally und Replay-Schreibschutz sind damit im aktuellen Build geprüft. Die vorherigen Fixture-Fehler bleiben archiviert. Beleg: `.git/integration-goal/context-native-20261001-r6/qualification.json`.

Das native Pointer-Cell-/Accepted-Tail-Fixture besteht Firefox Transfer und WebKit SAB. Die vier übrigen Fälle bleiben offen: drei verfehlen die ursprüngliche 100-ms-ACK-Grenze; Firefox SAB enthält ein fehlendes Startansicht-Move-Sample, dessen Opcode in diesem Lauf nicht aufgezeichnet ist. Alle 636 Klickgeometrien und vollständigen Metrikdateien sind gespeichert. Die Startbewegungs-p95-Werte liegen bei 49 bis 57,2 ms. Der JSON-Reporter scheitert zusätzlich an der Größe der eingebetteten Anhänge; seine liegen gebliebene vorherige Kontextdatei wird ausdrücklich nicht als aktueller Bericht verwendet. Der nächste Diagnoselauf referenziert die vollständigen Dateien als Pfadanhänge. Die ursprünglichen festen Endpunkte und deren fehlgeschlagene Abnahme bleiben separat. Beleg: `.git/integration-goal/latency-ground-native-20261001-r1/readout.md`.


Die abgeschlossene ACK-Diagnose enthält alle sechs unveränderten Fälle, 636 echte
Klicks und 18 vollständige Phasendateien. Vier Fälle bestehen ihre Assertions;
Chromium SAB verfehlt die mittlere ACK-Phase mit 100,205 ms, Chromium Transfer
verfehlt ACK-Grenzen und enthält einen tatsächlich gesendeten Guard statt Move.
Alle 636 Commands sind über tatsächliche Issue-, Worker- und ACK-Daten zugeordnet,
ohne Beobachterfehler oder Überläufe. Die direkte Differenz von nativer Klickzeit
und tatsächlicher Bestätigungszeit reproduziert alle 18 ursprünglichen
ACK-Statistiken exakt. Sendezeit und Klickzeit werden dabei getrennt gehalten.
Verspätete Worker-Weckzeiten sind aufgezeichnet; ihre Timer- oder Queue-Ursache ist
noch nicht belegt. Wegen der zusätzlichen Messarbeit gilt dieser Lauf ausdrücklich
nicht als Zeitabnahme. Quellen und alle 6466 ursprünglichen Build-Dateien sind exakt
wiederhergestellt. Beleg: `.git/integration-goal/ack-ground-timestamp-native-20261001-r1/analysis-r2/readout.md`.

Die Reparatur des JSON-Reporters bleibt unabhängig davon im Latenztest bestehen:
Dieselben vollständigen Dateien werden als Pfadanhänge gespeichert. Rohdaten,
Geometrie, Klickanzahl, Last und Grenzwerte sind unverändert. Die tatsächliche
Sechs-Fälle-Diagnose erzeugt damit einen aktuellen Bericht ohne Größenfehler;
Typecheck und Lint bestehen auch nach Entfernung aller Diagnosebeobachter.
Beleg: `.git/integration-goal/latency-file-attachment-fix-20261001/receipt.json`.

Der überarbeitete Worker-Profiladapter besteht alle 22 fokussierten Tests,
Typecheck, Lint und Harness-Build. Sein einzelner kontrollierter Browserlauf
bewahrt alle 30 Durchläufe und 270 Service-Fenster. Vier Fälle bestehen;
Chromium verfehlt die kalte 5-ms-Grenze mit 5,09 und 6,33 ms. Beide tatsächlichen
Worker-/Thread-Identitäten sind bestätigt. Alle 4336 Samples des 512-Profils und
17621 Samples des 1024-Profils sind in ihrer ursprünglichen Reihenfolge erhalten,
einschließlich eines negativen und eines Null-Deltas im 1024-Profil. Kein Sample
wird sortiert, gekürzt oder korrigiert. Der vorherige Parserfehler und dessen
vollständige Daten bleiben separat erhalten.

Der vollständige ursprüngliche Protokolllog und die tatsächlichen Startdaten
beider Chromium-Prozesse sind gespeichert. Die öffentliche Kommandozeilenabfrage
scheitert tatsächlich, weil die installierte Playwright-Version den dafür nötigen
Schalter nicht setzt. Dieser API-Fehler bleibt erhalten. Die installierte
Launch-Quelle protokolliert dieselben Argumente, die sie unmittelbar danach an
spawn übergibt. Alle 222 gespeicherten Chromium-Command-Vorkommen, die
130 unterschiedlichen vollständigen Requests, beide geordneten Startargumentlisten
und alle 32 ausgelieferten Ressourcen sind inzwischen geprüft. Der tatsächlich
ausgeführte Kontrollvalidator besteht ohne fehlende Prüfungen oder blockierende
Clock-Commands. Dies trägt eine ausdrücklich akzeptierte Quell-/Konfigurationsannahme;
ein nativer Kommandozeilen- oder Clock-Pointer-Nachweis wird nicht behauptet.

Der separat geprüfte Saved-Join-Helper besteht alle 15 ausgeführten Verträge.
Eine eigenständige Root-Quell-/Konfigurations-/Mathematikfreigabe bindet die exakten
Originaldaten und erlaubt die frische Berechnung der Unsicherheit. Die anschließende
Auswertung und unabhängige vollständige Prüfung aller 21957 Sample-Zeilen und
270 Fenster bestehen. Beide Chromium-Profile haben unter diesen ausdrücklichen
Engineering-Annahmen eine begrenzte Zuordnung. Die frische zusätzliche
Quellmodell-Fehlergrenze beträgt 13 Mikrosekunden; die vollständigen Marker-Brackets
bleiben separat erhalten und ergeben Offset-Intervalle von rund 46 Mikrosekunden
Breite. Der Helper prüft außerdem die Fenstergrenzen mit ihrer eigenen Fehlergrenze.
Die 13 Mikrosekunden sind daher nicht die gesamte Breite der Sample-Zuordnung.
Firefox-/WebKit-Profilzuordnungen bleiben unqualifiziert. Die frühere
unqualifizierte Auswertung und beide öffentlichen API-Fehler bleiben erhalten.

Im ersten kalten Nav-Aufruf bei Tick 2 liegen 38 beziehungsweise 47 Sample-Zeitpunkte
sicher innerhalb des Fensters; ein beziehungsweise zwei weitere bleiben am Rand
mehrdeutig. Die gespeicherten Frames zeigen dort unter anderem aPop und relaxSector.
Diese Anzahlen sind keine CPU-Dauern und belegen keine vollständige Stack-Sammelzeit.
Eine konkrete HPA-Änderung wird daraus außerhalb der aktiven Quellen vorbereitet.
Die ursprünglichen 5,09-/6,33-ms-Fehler bleiben bestehen; es gibt keinen neuen
Browserlauf, keine produktive Nav-Änderung und keine bestandene Zeitabnahme.
Belege: `.git/integration-goal/nav-controlled-saved-join-native-20261001-r1/root-acceptance/root-acceptance.json`,
`.git/integration-goal/nav-controlled-protocol-audit-native-20261001-r2-reviewed/audit.json`
und `.git/integration-goal/nav-controlled-saved-join-native-20261001-r1/approved-readout-qualification.json`.

Alle 201 ursprünglichen Quell-/Abhängigkeitsdateien und 17 kompilierten
Harness-Dateien sind bytegenau zurückgesetzt. Der Spielbuild bleibt
`b411bee7eaa2-d1d202021`. Belege:
`.git/integration-goal/nav-controlled-clock-native-20261001-r1/restore-qualification.json`,
`.git/integration-goal/nav-controlled-clock-native-20261001-r1/numeric-inspection/readout.json`
und `.git/integration-goal/nav-controlled-protocol-audit-native-20261001-r1/audit.json`.

Zwei weitere Diagnosekandidaten liegen ausschließlich außerhalb der aktiven
Quellen: tatsächliche Timer-/Ping-Eintritte für verspätete Worker-Weckzeiten und
das tatsächlich gewählte Kontextziel mit ursprünglicher Projektion und
Command-Bytes. Ihre Prüfung und echte Ausführung stehen aus. Die bestehende
Bodenfixture behauptet weiterhin keine Grenze für alle zukünftigen Frames.


Der separat eingefrorene ACK-Weckzeitkandidat R2 besteht inzwischen 46 tatsächliche
TypeScript-Tests in sechs Dateien und sieben Saved-Readout-Verträge. Darin sind
alle zwölf neuen Timer-/Ping-Eigentümerfälle und die 600-Tick-Arena-/Hash-/Replay-
Gleichheit enthalten. Die dafür vorübergehend installierten sechs Quellen sind
exakt zurückgesetzt, der neue Test ist entfernt und alle 6552 erfassten kompilierten
Dateien bleiben identisch. Typecheck, Lint, Allokationsprüfung, Browserbuild und
ursprüngliche native Sechs-Fälle-Diagnose stehen für diesen Kandidaten noch aus.
Beleg: `.git/integration-goal/ack-wakeup-focused-contracts-20261001-r2/qualification.json`.

Der HPA-Pair-Cursor-Kandidat besteht 576 Kantenlesefälle, 400 ursprüngliche
Routen und den Vergleich vollständiger Arena-Bytes bei beiden ursprünglichen
200-Einzel-/50-Gruppen-World-Lasten. Zusätzlich bestehen 53 tatsächliche Tests
in neun Dateien (30 Nav, 21 Hash-/Replay-Goldens, zwei vollständige Host-
Allokationsfälle), Typprüfung, Lint und Harness-Build. Die Allokationsfälle
liegen bei 554 und 995,1 KiB über je 10.000 gemessene Ticks mit 1.000 fahrenden
Einheiten und bestehen die ursprüngliche 1-MiB-Grenze.

Der anschließende unprofilierte Browserlauf führt alle sechs ursprünglichen
Fälle ohne Wiederholung aus. Fünf bestehen; Chromium auf der 1024er Karte liegt
kalt bei 5,4 ms und verfehlt die unveränderte 5-ms-Grenze. Alle sechs warmen
Messungen bestehen. Alle 30 Läufe behalten 200 Einheiten/Anfragen/fertige Pfade,
eine 50er-Gruppenanfrage, das Budgetargument 20.000 und höchstens zehn Service-Ticks.
Alle sechs Prüfungen ohne Audioausgabe bestehen. Der Kandidat ist verworfen.
656 Quell-/Eingabedateien und 117 kompilierte Dateien sind exakt zurückgesetzt;
weitere 6535 kompilierte Identitäten und der tatsächlich ausgelieferte d1d-Spielbuild
bleiben unverändert. Alle Rohdaten, Fehler, Quellen und Kandidaten-Builds sind
aufbewahrt. Dieser einzelne Lauf belegt keine kausale Beschleunigung.
Beleg: `.git/integration-goal/nav-pair-cursor-qualification-20261001-r1/native-trial-r1/qualification.json`.

Der Intel-Kandidat prüft die unveränderte Allianzbedingung vor zuvor ungenutzten
Zielkoordinaten. Vier tatsächlich ausgeführte Node-Vergleiche bestehen mit allen
ursprünglichen Chromium-/Firefox-/WebKit-Befehlen über jeweils 600 Ticks,
vollständigen Arena-Bytes und Hashes sowie Snapshot-Fortsetzung ab Tick 300.
Der erste Start scheiterte an Vitests Git-Verzeichnisausschluss, der folgende Lauf
am Node-Heap-Limit. Beide vollständigen Fehler bleiben erhalten. Eine separate
Testrevision vergleicht die großen finalen Snapshots vollständig byteweise;
Last, Fallzahl, Heap-Limit und Timeout sind unverändert. Der installierte Matcher
belegt eine große Property-Listen-Allokation, der konkrete Assertion-Ort des
OOMs ist nicht bestätigt. Die aktive Intel-Quelle und der Spielbuild bleiben
unverändert. Der ursprüngliche absolute 2-Prozent-Browser-Zeittest bleibt offen.
Beleg: `.git/integration-goal/ai-intel-parity-qualification-20261001-r1/qualification.json`.

Die nächsten Ausführungen bleiben einzeln: ACK-Weckzeitdiagnose R2, danach
Intel-Zeittrial und weitere begründete Nav-/GPU-Korrekturen. Der eingefrorene
ACK-Ausführungsplan benennt alle verbleibenden Befehle und 29 Compiler-Ausgabebäume
sowie den vollständigen Spielbuild und Testcache zur Sicherung. Er wurde noch
nicht ausgeführt. Beleg: `.git/integration-goal/ack-wakeup-execution-sequence-20261001-r1/plan.md`.
Der verworfene unveränderte Nav-Kandidat wird nicht für einen günstigen Zeitwert
wiederholt. ImageGen-Schritt 11 bleibt für jede neu fehlende Grafik verbindlich.

## Abnahmegrenzen

Funktionale Abnahme, deterministische Gleichheit und Zeitziele werden getrennt protokolliert.
Die vorherigen Zeitüberschreitungen werden nicht durch schwächere Last, andere Grenzwerte
oder deaktivierte Gates als behoben erklärt. Ein Fake-OPFS-Test ersetzt keinen echten
Tab-Abbruch. Ein HTTP-200-Status ersetzt keinen sichtbaren Spielstart.

Die lokale verfügbare Messmaschine ist Apple M5 Pro. Referenz-iGPU, native Safari-Läufe und
Spielerabnahmen erfordern die jeweiligen echten Umgebungen und werden nicht aus anderen
Tests abgeleitet. Dieses Goal beauftragt keinen Commit, Push oder Veröffentlichung.
