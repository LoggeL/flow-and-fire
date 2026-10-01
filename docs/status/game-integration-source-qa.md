# Game integration source QA

Stand: 2026-09-30. Die aktuelle Simulation verwendet `faf-sim/ms6.0`,
`simHash 0xa4e6c7dd`, Frame v5 (Header 192 Bytes, Watch 420 Bytes), FAFL v4 und GAME v3.
Die generierten Spielinhalte enthalten zwölf Einheiten, neun Waffen und fünf Projektile.

Die vollständigen Typechecks für Quellcode und Tests bestehen. ESLint besteht ohne Warnungen;
dependency-cruiser meldet keine Regelverletzungen für 1252 Module und 4627 Abhängigkeiten.
Die gezielte Prüfung der angepassten Fixtures besteht mit zwölf Dateien und 111 Tests.
Sie prüft unter anderem die realen Blueprint-IDs, Commander-Markierung, Asset-Übertragung,
aktuellen Frame- und Befehlsverträge, Host-Phasen, Sub-Hashes und die echte KI-Anbindung.
Weitere 36 Tests in fünf Dateien bestehen für World/Layout, Wirtschaft, Kampf und Replay.
Sie enthalten aufgezeichnete untainted Skirmish-Initialisierung, Desync-Diagnose, wiederholte
rückwärts gerichtete Suche und Wiederherstellung abgeschnittener Kommandologs.

Frame v5 überträgt zusätzlich tatsächlich abgerechnete Ressourcenverbraucher und ihre
beitragenden Bauhelfer, vollständige Fog-Snapshots aus Sicht- und Erkundungsdaten sowie alle
32 gemeinsamen Bauaufträge je Einheit. Die Flow-Raten stammen aus der echten Economy-Phase;
gemeinsame Baukosten bleiben beim Bauplatz und werden nicht auf Helfer geschätzt. Pausierte
Bauplätze behalten mit tatsächlichen Nullraten ihre Zeile zum Fortsetzen. Steigende Ressourcen-
Engpässe und Überlauf werden aus den autoritativen Army-Werten als private Frame-Events erzeugt.
48 gezielte Tests in sechs Dateien bestehen für die Erweiterung und die bestehenden Frame-,
Wirtschafts- und Kampfverträge. Sie prüfen auch Armee-Datenschutz, Wiederherstellung,
unveränderte Arena-Hashes durch Frame-Ausgabe und Fog nach Sichtverlust. Die Erweiterung
ändert weder das Arena-Layout noch die Regelwerte. Nach einer Snapshot-Wiederherstellung
sind Kostenbeobachtungen bis zum nächsten Economy-Tick ausdrücklich nicht verfügbar.

Die neun aktuellen Determinismus-Szenarien wurden für MS6 erneuert. Jeder Generator prüft
die Szenario-Assertions beziehungsweise die vollständige Hash-Kette sowie den abschließenden
Regel- und Voll-Hash, bevor er ein Golden schreibt. Anschließend bestätigten die drei
Generatoren ohne `--update` unveränderte Dateien. Eine davon unabhängige Vitest-Prüfung
bestand mit 69 Tests, einschließlich frischer Replay-Bytes und rückwärts gerichteter Suche.
Die Änderungen betreffen neun aktuelle JSON-Goldens, neun FAFL-Logs und neun portable
Replays. Historische MS1/MS2-Berichte und Karten wurden dabei nicht geändert.

Das Replay-Größenmodell enthält jetzt alle 18 aktuellen Regelregionen und verwendet für
Build den tatsächlichen 12-Byte-Encoder. Die bisherigen Grenzen bleiben unverändert:
30 Minuten 1v1 mit je 120 APM, höchstens 100000 Bytes CMDS und 250000 Bytes insgesamt.
Beide Grenzen bestehen. Das Größenmodell ersetzt keine nachsimulierte echte Spielpartie.

Der erste vollständige Vitest-Lauf umfasste 284 Dateien und 2999 Tests. Davon bestanden
2926 Tests; die 73 Fehler enthielten alte Goldens, überholte Fixture-Annahmen und drei
Allokationsfehler. Die Golden- und Fixture-Fehler sind in den gezielten Wiederholungen
behoben. Die Allokationsgrenzen wurden nicht gelockert. Die zuletzt abgeschlossenen Host-Läufe
vor der Frame-v5-Erweiterung bestanden für 10000 GC-freie warme Ticks mit 1000 bewegten Würfeln:
470,4 KiB auf der Plane und 556,7 KiB auf Hollow Ridge, jeweils 20 von 20 auswertbare Blöcke.
Die neue Frame-v5-Erweiterung ist in diesen Ergebnissen noch nicht enthalten; ihre endgültige
Allokationsprüfung braucht einen weiteren ruhigen, separat koordinierten Lauf.

Diese Prüfung bestätigt Quellcode, Datenverträge und deterministisches Abspielen.
Die Produktions-Build-, Browser- und Performance-Abnahme wird separat dokumentiert.
Automatisierte Browser-Tests müssen die stille Ausgabe vor der ersten Navigation installieren.

Der erste native Browserlauf auf Build `b411bee7eaa2-d19627dff` umfasst 15 Fälle mit einem
Worker auf Chromium, Firefox und WebKit. Zwölf Fälle bestehen: der vollständige Gefechtstest,
20 geteilte Bauaufträge mit Ingenieur-Übernahme sowie Gelände-, Wasser- und Minimap-Fog mit
SAB und Transfer auf allen drei Engines. Die drei Replay-Fälle bestehen noch nicht.
Chromium und WebKit zeigen beim Import den Produktfehler
`invalid message to sim host (t=replay-inspect)`. Firefox erreicht die Aufnahme wegen eines
frühen Menü-Setup-Resets nicht. Rohberichte, Screenshots, Traces, ursprüngliche Testquellen
und SHA-256-Inventar sind unter `.git/integration-goal/browser-acceptance-20260930-132749/r1`
gesichert. Ein neuer Build und eine gezielte Wiederholung bleiben erforderlich.

Der zweite native Lauf auf `b411bee7eaa2-d320eb85f` umfasst 21 Fälle. Elf bestehen:
Gefecht und beide Fog-Transporte auf allen Engines sowie 20 geteilte Bauaufträge auf Firefox
und WebKit. Chromium verliert den unmittelbar nach Auswahl aktivierten Bau-Modus. Die drei
Cursor-Fälle erreichen gültige/gesperrte Bau-Cursor, reale Konstruktion und die vier gemessenen
Screenshots für leere Auswahl und Commander, scheitern danach an der überholten Annahme,
die A-Produktionskarte erzeuge einen Ingenieur. Die drei Replay-Fälle importieren nun korrekt,
vergleichen die gespeicherten HASH-Grenzen und tatsächliche Ressourcen sowie AI-Fabrik-Daten,
scheitern aber an einer Testannahme zum aktiven Queue-Kopf. Die drei Gelenk-Fälle prüfen reale
Kampf-Ausrichtung, Laufneigung und Rücksetzen nach Zielzerstörung, scheitern beim abschließenden
nativen Bewegungsauftrag. Der gesamte zweite Nachweis bleibt unverändert unter
`.git/integration-goal/browser-acceptance-20260930-141737/r2` erhalten. Die Tests korrigieren
Hover-/Karten-/Queue-Koordination; eine Controller-Korrektur für unmittelbar geänderte Auswahl
und eine anschließende Wiederholung sind noch erforderlich. Vollständige Cursor-, Replay-
und Gelenk-Abnahme ist damit noch nicht bestätigt.

Der Gefechtstest startet
über Hauptmenü und Setup mit einem Menschen, normaler KI, Hollow Ridge und tatsächlichem
3x-Starttempo. Er prüft Ressourcen- und Statusleisten bei 1440×900 und 1280×720, Fabrikbau per
A-Taste, belegte Baufläche, sichtbare Baubeams, Ingenieurproduktion mit Wiederholung und Pause,
Rally per Linksklick sowie Aufgeben, Niederlage, Revanche und Rückkehr ins Hauptmenü.
Der Replay-Test zeichnet mindestens 900 regulär geplante Ticks auf, weist echte KI-Bau- und
Produktionsbefehle nach und vergleicht fünf Vorwärts- und Rückwärtssprünge mit den gespeicherten
HASH-Einträgen. Export, Import, Perspektive, Tempo und identische Download-Bytes sind enthalten.

Die ausdrücklich aktivierte OPFS-Prüfung läuft mindestens 600 reale Sekunden bei 1x mit
300 Würfeln und verlangt mindestens 5900 fortgeschrittene und gespeicherte Ticks. Sie löst
einen tatsächlichen Chromium-Tab-Absturz aus und öffnet im selben Browserkontext eine neue
Seite mit zuvor installiertem stillen Audioschutz. Das rohe Log darf keinen END-Eintrag haben;
der Export seines gültigen Präfixes wird anschließend unabhängig mit allen aufgezeichneten
Regel-Hashes, erzeugten Tabellen-Hashes und dem letzten gespeicherten Hash nachsimuliert.
Die Replay- und OPFS-Flows sind erst nach ihren erfolgreichen Browserläufen Abnahmenachweise.

Der Frame-v5-Verbraucher für geteilte Bauaufträge zeichnet alle eigenen und verbündeten
Warteschlangen unabhängig vom 16-Ziele-Watch. Vier gezielte Tests sowie fünf vorhandene
HUD-Tests bestehen für 32 Plätze, 20 geteilte Bauflächen, echte Baustellen-Unterdrückung,
Übernahme, Rücksprünge und Kamerabewegung bei Pause. Der native Browser-Flow für 20 reale
geteilte Bauaufträge und Ingenieur-Selbstzerstörung besteht auf allen drei Engines.
Sein begrenzter Aufbau erzeugt zwei Ingenieure über Diagnose-Spawn-Befehle und kennzeichnet
den Nachweis ausdrücklich als tainted. Alle anschließenden Bau- und Selbstzerstörungsbefehle
laufen über die normale Oberfläche; direkte Weltänderungen und erfundene Frames sind ausgeschlossen.

Die vollständigen Befehle, Ausgaben und SHA-256-Inventare liegen lokal unter
`.git/integration-goal/package10-*`.

Die elf vorhandenen Varkan-Modelle sind im Produktions-Build `b411bee7eaa2-d84d54d9b`
mit ihren drei LODs, Materialfarben, Teammasken und Leuchteffekten eingebunden. Die Fabrik
passt durch eine reine Darstellungs-Skalierung in ihre tatsächliche Baufläche. Simulationsdaten
und beide ursprünglichen Würfel-GLBs sind gegenüber dem vorherigen Build bytegleich.
Sechs stille Browser-Prüfungen auf Chromium, Firefox und WebKit mit SAB und Transfer bestehen
für das tatsächliche Laden und Zeichnen aller Modelle ohne GL- oder Seitenfehler. Die
Diagnose-Aufstellung ist ausdrücklich tainted und ersetzt keine reguläre Gefechtsabnahme.
Der korrigierte Materialkontrast wurde am gerenderten Bild geprüft, der Build ist in Brave
geöffnet. Gelenke und Türme sind weiterhin starr. Nachweise: `.git/integration-goal/models-*`.

Der gemeinsame Build `b411bee7eaa2-d19627dff` enthält nun auch die Frame-v5-Fog-Anbindung
für Gelände, Wasser und Minimap, echte geteilte Bauwarteschlangen und die Replay-Inspektion
der angenommenen Armee-Perspektive. Globale Typprüfung, ESLint und Dependency Cruiser
bestehen. Die vier Modell-Vertragstests liegen jetzt in `apps/game/test/model-assets-contract.test.ts`,
wo die zulässige Game-Integration sowohl Asset-Pipeline als auch Client-Verbraucher prüfen kann.
Die Paketregeln wurden dafür nicht gelockert; die benötigte Testabhängigkeit ist deklariert.

27 gezielte Game-HUD-, Fog-, Flow-, Alert-, Warteschlangen- und Einstellungsprüfungen sowie
16 gezielte Client-/Replay-Host-Prüfungen bestehen. Perspektivwechsel und Rücksprünge tauschen
Ressourcen, Auswahl und Fog sofort aus. Fabrikdetails verwenden tatsächliche Watch- und
Flow-Daten; ohne gültige Produktionsrate wird keine erfundene Restzeit angezeigt.
Auf dem zuvor gebauten Stand `b411bee7eaa2-d6f9bb9a6` bestehen alle sechs stillen Fog-Browserfälle
für Chromium, Firefox und WebKit mit SAB und Transfer. Gerenderte Pixel werden erst nach der
tatsächlichen Kamerabewegung verglichen. Der aktuelle gemeinsame Build wird nun zusätzlich
mit den regulären Gefechts-, Replay-, Fog- und geteilten Bauabläufen geprüft; diese laufenden
Browserfälle sind hier noch kein abgeschlossener Nachweis.

Das unveränderte kalte 5-ms-Pathing-Ziel wird weiter in drei der sechs ursprünglichen Fälle
verfehlt. Ein zusätzlicher gepackter Heap-Schlüssel bewahrte die Referenzrouten, verbesserte
die Zeitabnahme aber nicht und wurde zurückgenommen. Die ursprünglichen Arbeitsmengen und
Zeitgrenzen bleiben bestehen. Nachweis: `.git/integration-goal/perf-package9-receipt.md`.

Die native FA-v3-Prüfung des Builds `b411bee7eaa2-da6439225` wurde nach 5,7 Minuten
gezielt abgebrochen und ist keine Abnahme: drei Chromium-Fälle bestehen (Gefecht und beide
Fog-Transporte), vier scheitern, ein Firefox-Fall wurde unterbrochen und 13 Fälle liefen
nicht. Die vier echten Chromium-Bilder für leere Auswahl und Commander bei 1440×900 und
1280×720 erfüllen die geprüfte Anordnung mit gestapelten Ressourcen, Befehlen unten links
und benachbartem Auswahltext. Der 20-Bauflächen-Test erreicht alle gemeinsamen Aufträge,
Kameraprojektion bei Pause und die Unterdrückung der ersten tatsächlichen Baustelle, wartet
anschließend jedoch auf den Selbstzerstörungsbutton im geschlossenen Details-Bereich.
Weitere Befunde sind vertauschte Repair/Reclaim-Tasten im optionalen Cursor-Test, ein
unpassender Vergleich von Replay-`innerText` mit `textContent` und Seitenfehler wegen des
fehlenden HUD-Typs `core:lnd_t3_heavy`. Der vollständige JSON-Bericht, Bilder, Traces,
unveränderte Quellstände, Build-Manifeste und SHA-256-Inventare liegen unter
`.git/integration-goal/browser-acceptance-20260930-150935`. Der tatsächliche Playwright-Prozess
wurde per SIGINT beendet; Testports 4183/4184 und Jobprozesse sind geschlossen, der
Produktionsserver auf 5199 blieb bestehen. Der native Details-Öffner, die korrekten
ORDER_DEFS-Tasten und der unveränderte `innerText`-Vergleich sind danach als reine
Testanpassungen ergänzt; ein neuer vollständiger Lauf steht aus.

Der vollständige native R5-Lauf auf `b411bee7eaa2-d97fa2eeb` endet mit 17 bestandenen
und vier fehlgeschlagenen Fällen in 7,1 Minuten. Replay-Aufzeichnung und Inspektion,
reguläres Gefecht, tatsächliche Modellgelenke im Kampf sowie Fog mit SAB und Transfer
bestehen jeweils auf Chromium, Firefox und WebKit. Die fünf ursprünglichen gespeicherten
Replay-HASH-Vergleiche und die zusätzlichen Perspektiv-/Inspektionsvergleiche bleiben erhalten.
Die neue Veröffentlichung eines echten Watch-Frames beim pausierten Auswählen funktioniert
auf allen drei Engines: Rally, fünf Produktionsaufträge, Pause/Resume, regulär erzeugter
Ingenieur und native Shift-Auswahl von Commander, Fabrik und Ingenieur erreichen ihre
Prüfungen. Je Engine liegen acht tatsächliche Bilder für leere Auswahl, Commander, Fabrik
und Mehrfachauswahl bei beiden Größen vor; die geprüften FA-v3-Abstände, fehlende Minimap
und Porträts sowie freie Canvas-Flächen bestehen. Anschließend scheitert der Cursor-Fall
jeweils an `pan` statt `arrow`, wenn Escape während eines echten Mitteltasten-Drags das Menü
öffnet. Der 20-Bauflächen-Übernahmetest besteht auf Chromium und WebKit; Firefox erreicht
den Tod des ursprünglichen Engineers und den verbleibenden einzelnen Auftraggeber, dessen
Warteschlange aber innerhalb von 60 Sekunden nicht von 20 auf 19 sinkt. Die Ursache ist
noch nicht nachgewiesen. Eine vollständige Abnahme liegt damit weiterhin nicht vor.
Alle Berichte, Einzelbelege, Bilder und Traces sind unverändert unter
`.git/integration-goal/browser-acceptance-20260930-154601-r5/r5` archiviert. Die Testprozesse
und Ports 4183/4184 sind geschlossen; der Server auf 5199 bleibt bestehen.

Der abschließende gemeinsame Build `b411bee7eaa2-de4fd6c56` besteht nach 85 gezielten
Tests in 15 Dateien sowie globaler Quell-/Test-Typprüfung, ESLint und Dependency Cruiser.
Der anschließend vollständig ausgeführte native R6-Lauf besteht mit 21 von 21 Fällen
auf Chromium, Firefox und WebKit, einem Worker, ohne übersprungene, wiederholte oder
flaky Fälle in 332,9 Sekunden. Die unveränderten Prüfungen weisen die echte pausierte
Fabrikauswahl und Produktion, das Menü-Reset bei gedrückter Mitteltaste sowie die Übernahme
der ursprünglichen gemeinsamen Baustelle nach Selbstzerstörung nach. Alle drei Engines
prüfen jeweils acht echte Bildschirmbilder für leere Auswahl, Commander, Fabrik und native
Mehrfachauswahl der drei regulär vorhandenen Typen bei 1440×900 und 1280×720. Alle acht
nativen Edge-Pan-Richtungen werden tatsächlich geprüft; es gibt hierfür keine Fokus-Ausnahme.
Die Kamera der repräsentativen Bilder steht am eigenen Commander mit Abstand 52 WU.
Die ursprünglichen fünf gespeicherten Replay-HASH-Vergleiche, Armee-/Beobachter-Inspektion,
echte Watch-Produktionsdaten, unveränderte Befehlssequenz im Read-only-Replay sowie die
Terrain-/Wasser-Fog-Pixel- und Datenschutzprüfungen bestehen vollständig. Der Aufbau des
20-Bauflächen-Falls bleibt ausdrücklich tainted durch zwei Diagnose-Spawn-Befehle; seine
anschließenden Bau-, Kamera- und Selbstzerstörungsaktionen verwenden die native Oberfläche.
Der vollständige JSON-Bericht, 21 lesbare Einzelbelege, alle tatsächlichen Bilder, Quellstände,
Build-Manifeste, Common-Check-Ausgaben und SHA-256-Inventare sind unverändert unter
`.git/integration-goal/browser-acceptance-20260930-161138-r6` archiviert. Testprozesse und
Ports 4183/4184 sind beendet; der Produktionsserver auf 5199 mit PID 68086 bleibt bestehen.
Diese Abnahme schließt die sechs genannten Browser-Specs ab. Das weiter aktive Gesamtziel
enthält weiterhin die gesonderte 600-Sekunden-OPFS-Absturzprüfung und offene Zeitabnahmen;
R6 liefert dafür keinen Ersatznachweis.

Die gesonderte OPFS-Absturzprüfung R2 besteht auf demselben unveränderten Game-Build
`b411bee7eaa2-de4fd6c56` mit einem Chromium-Worker, ohne Retry oder übersprungenen Fall.
300 tatsächliche Cubes laufen 600,010062 gemessene Wandsekunden bei 1x und ohne Pause;
der akzeptierte Frame steigt von Tick 1 auf 6001. Ein tatsächliches CDP-`Page.crash`
beendet den Tab, danach liest ein neuer Tab im selben Browserkontext und Ursprung die
ursprüngliche OPFS-Datei. Der unverändert archivierte Rohlog hat 12.168 Bytes, keinen END
(`endTick=-1`), keine abgeschnittene oder korrupte Entry-Folge und 600 persistierte HASHs
bis Tick 6000. Der native Replay-Bibliotheksexport enthält 7.700 Bytes und ist korrekt als
Teilaufnahme markiert. Die unabhängige Node-Simulation vergleicht alle 600 gespeicherten
HASHs und alle 60 Tabellen-Checkpoints über 18 Regionen, insgesamt 1.080 Tabellenwerte,
ohne Divergenz. Der End-Rule-HASH `3475173311` stimmt mit dem letzten persistierten HASH
überein. Der Legacy-Cube-Aufbau enthält ausdrücklich einen Cheat-Mark bei Tick 1 und ist
daher tainted; diese Lastqualifikation ist keine Abnahme eines ungetainteten Gefechts.
Es gibt keine Host-, Seiten- oder Console-Fehler. Vor dem Crash sind Silent-Guard und ein
Stream-Ziel installiert, Hardware-/blockierte Verbindungen stehen auf null; der neue Tab
installiert denselben Guard vor Navigation und besteht die erneute Kontrolle.

R1 bleibt als fehlgeschlagener Harness-Lauf unverändert archiviert: das tatsächliche
Crash-Ereignis trat ein, die ursprüngliche `Promise.all`-Orchestrierung wartete jedoch bis
zum 15-Minuten-Timeout auf eine unbeantwortete CDP-Protokollantwort. R2 wartet auf das
autoritative Page-Crash-Ereignis und behält sämtliche ursprünglichen Last-, Zeit-,
Persistenz- und HASH-Grenzen bei. Vollständiger nativer JSON-Bericht, Vor-Crash-Messbeleg,
OPFS-Rohlog, exportiertes Replay, Parser-Metadaten, Quellstände, Build-Manifeste,
Prozess-/Portkontrollen und SHA-256-Inventar liegen unter
`.git/integration-goal/opfs-tabkill-20260930-165248-r2`. Der Job
`goal-opfs-600-tabkill-r2` endet mit Exit 0; Testprozesse und Ports 4183/4184 sind geschlossen,
5199 mit PID 68086 bleibt bestehen. Die 600-Sekunden-OPFS-Abnahme ist damit abgeschlossen;
das Gesamtziel bleibt wegen der getrennten Simulations-/Last- und Zeitabnahmen aktiv.
