# Abschluss am 1. Oktober 2026

Die sieben begonnenen Tracks sind im gemeinsamen Projektordner integriert. Die
spielbare Entwicklungsversion läuft auf der HomeBox:
[Flow & Fire starten](https://faf.logge.top/?menu=1).
Das [Repository](https://github.com/LoggeL/flow-and-fire) ist öffentlich;
[README](../../README.md) und [Docker-Anleitung](../deployment.md) beschreiben Start
und Bedienung. Der ausgelieferte Spielbuild ist `6753e2636876`, Sim-Version
`faf-sim/ms6.3-factory-tiers-radar`. Die ältere Adresse bleibt als Alias erreichbar.

## Umgesetzter Umfang

| Bereich | Ergebnis |
| --- | --- |
| Simulation/MS3 | Deterministische Wirtschaft, Ressourcenverbrauch, Bauen, Fabrikproduktion, Kampf, Sicht und Spielereignisse |
| KI | Wahrnehmung und Commands aus der echten Simulation, Browser-Worker und Scheduler, Inline-Ausführung und deterministische Befehlswiedergabe |
| Audio | Spielereignisse und Klickbestätigung im laufenden Spiel, Session-Abbau vor einem historischen Replay |
| Editor | Karten- und Markerwerkzeuge im gemeinsamen Workspace; Originalkarten und Archive bleiben erhalten |
| HUD | Echte Spielzustände und Commands, Mehrfachauswahl, Shift-Ziehbau, Fabrik-Rally, bezahlte ACU-, Extraktor- und Fabrik-Upgrades, Ergebnisstatistik |
| Darstellung/FX | Modelle mit artikulierten Teilen und Gehbewegung, Projektile, Baubeams, Kampf- und Todesereignisse, Render-Passes |
| Replay | Aufnahmebibliothek, Player, Seek, Export, historische Builds und tatsächliche OPFS-Wiederherstellung nach Tab-Abbruch |

Gelände ist vorab erkundet. Aktuell sichtbare Bereiche sind hell, der übrige Bereich
ist verdunkelt; die Sichtgrenze auf Terrain und Wasser läuft weich aus.
Einheiten-/Gebäudeglyphen, Cursors, Favicon und die erzeugten ACU-Upgradeicons sind
angeschlossen. Ausgewählte Fabriken zeigen den akzeptierten Rally-Punkt, und ihre
produzierten Einheiten laufen dorthin. Masseextraktoren lassen sich mit tatsächlicher
Ressourcenabrechnung über T1, T2 und T3 ausbauen, pausieren und abbrechen.

Korrektur nach dem Review vom 1. Oktober 2026: Im Build `48ecd86e71a1` ließ die Folge
Upgrade → Pause → Abbrechen ACU oder Extraktor pausiert zurück (Einkommen und Baukraft
ruhten). Der HUD-Abbruch sendet jetzt für eine pausierte Upgrade-Einheit `Stop` und
danach `TogglePause(false)`; generischer Stop bleibt unverändert. Vertrag:
`apps/game/test/upgrade-cancel-resume.test.ts`. Siehe
[Fixes vom 1. Oktober](opus-fixes-2026-10-01.md).

Das Opus-Review ist umgesetzt: lesbarere Menüs und Bauglyphen, weicheres Sichtfeld,
Ergebnisstatistik, Replay-Suche und lokale Anzeigenamen. Fabriken lassen sich bis T3
ausbauen; Geschützturm und Radar sind im normalen Bauangebot vorhanden. Auch eine
pausierte Partie kann nach Bestätigung aufgegeben werden.

Die anschließende [HUD-Anpassung an die Forged-Alliance-Screens](../design/supcom-ui-2026-10-01/README.md)
ist ebenfalls ausgeliefert: Stahlrahmen, horizontale Bauliste mit Bildern der echten Modelle,
Auswahl über Befehlen und kompakte Fabriksteuerung. Im öffentlichen Build bestehen
24 Layoutprüfungen an vier Fenstergrößen und die tatsächlichen Spiel-/Replay-Abläufe.

## Nachweise und ihre Grenzen

Nach dem Opus-Review bestehen die lokale Suite mit 3339 Tests, Typprüfung und Lint.
Für die Lieferung wurden 35 betroffene Verträge und acht Archivtests erneut geprüft.
Der öffentliche Build `7fc3bcf2cc72` besteht den tatsächlichen Chromium-Ablauf: Start,
pausierten Ausbau abbrechen, danach Fabrik fertigstellen und einen Ingenieur produzieren,
im Pausemodus aufgeben, Ergebnisstatistik öffnen und das neue Replay prüfen. Eine alte
Aufnahme lädt den Originalbuild `48ecd86e71a1`; drei Vorwärts-/Rückwärts-Seeks stimmen
mit ihren aufgezeichneten Regel-Hashes überein. Der Container ist gesund und hat keine
Neustarts. Siehe [Deployment-Abnahme](deployment-2026-10-01.md).

Die frühere ms6.2-Spielkorrektur hat 96 betroffene Verträge, 60 Hash-/Replay-Golden-Verträge
sowie sechs tatsächliche Rally-/Extraktor-Spielabläufe in Chromium, Firefox und WebKit
bestanden. Drei weitere Browserprüfungen öffnen eine unveränderte alte Aufnahme nach
dem Docker-Update, suchen vorwärts und rückwärts, spielen sie ab und exportieren
identische Bytes. Der öffentliche Normal-KI-Spielstart mit Auswahl, Bewegung und
Fabrikbaumodus bestand ohne Browser- oder Hostfehler. Der Container ist gesund.

Die früheren Abnahmen enthalten 24 UI-Fälle, drei Audio-Fälle, sechs echte Kampf-/
Kontextfälle und eine zehnminütige Aufnahme mit tatsächlichem Tab-Abbruch und
OPFS-Wiederherstellung. Ihre jeweiligen Builds und Fehler bleiben in der
[Integrationshistorie](integration-history.md) und den lokalen Originalbelegen erhalten.
Diese früheren Prüfungen werden nicht als erneute vollständige Abnahme von ms6.3
ausgegeben. Firefox, WebKit und Performance-Gates wurden für die Opus-Lieferung
nicht erneut ausgeführt. Automatisierte Browserprüfungen verwenden vor der Navigation eine
Hardware-Audiosperre; Lautsprecher werden dabei nicht verbunden.

Zum Abschluss wurden zwei veraltete Test-Erwartungen auf die tatsächliche ms6.2-
Sim-Identität und die 14 referenzierten Modelle angepasst. Typprüfung und Lint bestehen;
26 betroffene Modell-, KI-/Host- und Replay-Verträge bestehen. Der separat untersuchte
Intel-Kandidat bestand vier vollständige Arena-/Hash-/Snapshot-Vergleiche, wurde aber
ohne vollständige native Zeitabnahme zurückgesetzt. Der ausgelieferte KI-Code bleibt
die Grundlage. Alle 9301 zuvor gesicherten kompilierten Dateien sind bytegleich erhalten.

## Verbleibende Einschränkungen

Die strikten Performance-Ziele sind nicht vollständig bestanden:

- Kaltes Pathing überschreitet in einzelnen ursprünglichen Browser-/Kartenszenarien
  die 5-ms-Grenze. Verwerfungen und unveränderte Lasten bleiben dokumentiert.
- Einzelne WebKit-ACK-Messungen liegen bei 101 ms statt höchstens 100 ms. Ein
  Firefox-Fall erzeugte einen echten Guard-Befehl und dadurch nur 39 von 40 erwarteten
  Move-Messpunkten; sein Befehl wurde im nächsten Tick ausgeführt und bestätigt.
- Im ursprünglichen Hard-KI-Zeitvergleich lag Chromium bei 9,48 statt 9,26 ms,
  entsprechend 2,38 Prozent statt höchstens 2 Prozent absoluter Differenz.
- Shield- und Shadow-GPU-Zeiten überschreiten in Chromium die Ziele. Fehlende
  GPU-Timer in Firefox und WebKit bleiben unqualifiziert.

Diese Befunde sind offene Einschränkungen der Entwicklungsversion. Grenzwerte, Lasten
und Fehlbelege wurden nicht abgeschwächt oder als bestanden umgedeutet. Externe
Referenzhardware, native Safari-Prüfungen und Spielerakzeptanz sind nicht qualifiziert.
Weitere Performance-Experimente gehören zum Backlog und starten bei einem konkreten
Spielproblem oder einem neuen Auftrag. Das beauftragte Integrations- und Lieferpaket
ist abgeschlossen.
