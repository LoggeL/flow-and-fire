# Gesamt-Review mit Claude Code Opus, 1. Oktober 2026

Die nächste Umsetzung sollte den Abbruch pausierter Upgrades korrigieren und den
Pausezustand einer Einheit sichtbar machen. Danach folgt die Lesbarkeit des
Schlachtfelds. Diese Reihenfolge ist das Ergebnis zweier Review-Runden mit Claude Code
Opus 5.5 und einer zusätzlichen Prüfung der tatsächlichen Aufnahme durch den Hauptagenten.

Geprüft wurde der öffentliche Spielbuild `48ecd86e71a1` mit dem aktuellen Quellstand
`c576c5c6bbefc4438d6dc16e2987eb81b224a3ae`. Die spätere Quellversion unterscheidet sich
vom Spielrelease nur in zwei Testfixtures und zwei Statusdokumenten. Am Spielcode und
Deployment wurde für dieses Review nichts geändert.

## Grundlage

Der Hauptagent hat 50 unveränderte Screens aus der veröffentlichten Version und dem
lokalen Marker-Editor aufgenommen. Opus hat 49 dieser Bilder und drei lokale
FA-Referenzbilder tatsächlich mit seinem Read-Tool gelesen. Das ausgelassene Bild ist
eine bereits durch die ergänzende Aufnahme ersetzte Capturefehler-Ansicht, kein eigener
Screen. Die Toolaufrufe waren erfolgreich. Die CLI meldet in beiden Runden
`claude-opus-5-5`; verwendet wurde Claude Code 2.1.285 mit ausschließlich Read, Glob
und Grep. Opus hat selbst keine Tests, Browseraktionen oder Änderungen ausgeführt.

Die automatisierten Aufnahmen verbinden keine Lautsprecher. Der Hardware-Audioguard
wurde vor jeder Navigation installiert. In allen 50 Screen-Datensätzen stehen
`speakerConnections=0` und `blockedConnections=0`. Die ergänzende Aufnahme zeigt
tatsächlichen Fabrikbau, Produktion, Mehrfachauswahl, Mex-Ausbau und Shift-Ziehbau im
normalen, unmarkierten Spiel. Drei Fehler des ersten Capturetreibers bleiben erhalten;
die ergänzende Aufnahme korrigiert die Selektoren, den Mex-Hotkey und die verwendete API.
Sie sind nicht pauschal als Spielfehler bewertet.

Das lokale Reviewpaket enthält:

- [Screen-Galerie](../../test-results/opus-review-20261001/screens.html)
- [Aufnahme- und Quellenübersicht](../../test-results/opus-review-20261001/review-packet-summary.json)
- [Erste Opus-Bewertung, unverändert](../../test-results/opus-review-20261001/opus-round1.md)
- [Gegenprüfung und endgültige Entscheidung](../../test-results/opus-review-20261001/opus-round2.md)
- [Prüfung der aufgezeichneten Pausefolge](../../test-results/opus-review-20261001/recorded-pause-audit.json)

Die Erstrunde enthält Aussagen, die Opus in Runde zwei korrigiert hat. Maßgeblich sind
die Gegenprüfung und der folgende Abschluss. Die Rohbelege liegen lokal im ignorierten
Verzeichnis `test-results/opus-review-20261001/`.

## Wichtigster bestätigter Fehler

Die Folge **Upgrade starten → pausieren → abbrechen** entfernt den Upgrade-Auftrag,
lässt aber das allgemeine Wirtschaftspause-Flag der Einheit gesetzt. Beim ACU stehen
dadurch Grundeinkommen und Baukraft still. Ein anschließend beauftragtes Landwerk wird
nicht weitergebaut. Das Auswahlpanel zeigt den Grund nicht unmittelbar; die generische
Fortsetzung ist hinter den Details verborgen.

Die Einheit ist dabei weder zerstört noch irreversibel gesperrt. Opus korrigiert seine
ursprüngliche Beschreibung und bewertet den Fehler als P1 mit höchster Umsetzungsvorrang,
weil die naheliegende Bedienfolge den einzigen anfänglichen Bauer betrifft und der
Workaround schwer zu finden ist.

Der Hauptagent hat die frische öffentliche Aufnahme vollständig mit dem ReplayPlayer
nachgespielt, ohne neue Commands oder Änderungen am World-Zustand:

| Tick | Tatsächlicher Befehl | Zustand danach |
| --- | --- | --- |
| 23 | Upgrade | Wirtschaftspause aus |
| 33 | Pause | `ecoPaused=1` |
| 35 | Stop durch Upgrade-Abbruch | Auftrag entfernt, `ecoPaused=1` bleibt |
| 38 | Neuer Bauauftrag | `ecoPaused=1`, keine Baukraft |
| 2553 | Ende der Aufnahme | `ecoPaused=1`, `flowPower=0` |

255 Regelhashes und 25 Tabellenhash-Prüfpunkte stimmen ohne Divergenz. Die Aufnahme ist
vollständig und unmarkiert. Ein frischer Fabrikbau ohne die Pause-/Abbruchfolge gelingt
in der ergänzenden Aufnahme. Für den Extraktor bestätigt die Quelle denselben
Abbruchpfad; eine eigenständige vollständige Replay-Reproduktion dieser Fehlerfolge
wurde im Review nur für den ACU ausgeführt.

Die betroffenen Stellen sind `apps/game/src/hud/live.ts:612` und `:670`,
`packages/sim/src/commands.ts:319` sowie `packages/sim/src/economy.ts:178` und `:186`.
Die bisherigen Tests prüfen Pause, Fortsetzen und danach Abbruch. Die direkte Folge
Pause → Abbruch braucht einen eigenen Vertrag.

## Bewertung der Screens und Abläufe

| Bereich | Befund | Einordnung |
| --- | --- | --- |
| Hauptmenü | Leere Angaben zu Sim/Transport, nie befüllte letzte Partie, Zurück-Button im Hauptmenü, interne MVP-Bezeichnungen | Bestätigte Integrationslücken und Textprobleme |
| Einstellungen | „Grafikleistung messen“ meldet tatsächlich „in diesem Spiel nicht verfügbar“; GPU-Feld leer; Tastenübersicht erklärt die Aktionen kaum; Umbelegen verweist auf C20 | Sichtbar bestätigt, teils unimplementierte Operationen |
| Credits | Technische Bibliotheksnamen und ein anderer, kaum gestalteter Screen | Sichtbarer Platzhalter |
| Gefechtssetup | Farbe und Team erscheinen leer, weil Anfangswerte nicht zu den Select-Optionen passen; Kartenvorschau verwendet erfundene Geländebänder und Ressourcenpositionen | Durch Bilder und Quelle bestätigt |
| Spiel-HUD | Kompakte Anordnung und Mehrfachauswahl funktionieren; Beschriftungen mischen deutsche Namen, englische Befehle und interne Abkürzungen | Funktional vorhanden, Verständlichkeit verbesserbar |
| ACU-/Mex-Upgrades | Kosten, Ertragsänderung, Fortschritt und Pause sind sichtbar; direkte Pause-/Abbruchfolge hinterlässt eine verborgene Pause | Bestätigter Fehler mit Vorrang |
| Bau und Produktion | Gültige/ungültige Footprints, Shift-Ziehbau, Produktion und Rally sichtbar; gefülltes Fabrikpanel wird am unteren Rand abgeschnitten | Funktionale Belege plus sichtbarer Layoutfehler |
| Auswahl und Gruppen | Typen und Anzahl sind lesbar; kleine Gruppen-Chips bleiben schwer verständlich | Bildkritik, kein belegter Simfehler |
| Schlachtfeld | Nahe Startkamera, gleichförmige grüne Textur, dominante Neonringe und sehr dunkle erkundete Bereiche | Konkrete Bildkritik gegenüber der FA-Referenz |
| Ergebnis | Niederlage zeigt fast nur Titel und Spielzeit; echte kumulative Ergebnisdaten sind nicht angeschlossen | Sichtbare Integrationslücke, separate Datenschnittstelle nötig |
| Replay | Import, Export und Seek sichtbar; Gestaltung unterscheidet sich stark vom HUD; „0 Hashes, keine Abweichung“ klingt wie eine erfolgte Prüfung | Funktional vorhanden, Darstellung und Aussage verbessern |
| Marker-Editor | Echtes Relief, klarere Werkzeuge und Hilfe, auch bei 1280 gut angeordnet; separates Farbsystem | Stärkste Werkzeugansicht im Review, lokal geprüft |

Opus hat in der Gegenprüfung zusätzlich Replay-Controller und historische Kompatibilität,
Session-Settings, Rig-Pose, Cursor-Zustandsautomat und Editor-App gelesen. Dort hat er
keinen wichtigeren bestätigten Fehler als die Upgrade-Pause gefunden. Die Berechnung
von Gangphase und Turmrichtung aus Frame-Deltas erscheint ihm schlüssig. Das ist eine
Quellenbewertung, keine Abnahme der sichtbaren Bewegung.

Weitere fehlende Spielinhalte bleiben erkennbar: Die normale Fabrikprogression endet
bei T1; T2/T3-Fabriken und deren Produktionszugänge fehlen. Radar und Verteidigung sind
im normalen ACU-Bauangebot nicht enthalten. Das ist ein Inhalts-Backlog und wird nicht
mit einem Fehler bereits vorhandener Bedienabläufe vermischt.

## Drei visuelle Verbesserungen mit dem größten Nutzen

1. **Strategische Übersicht:** Das vorerkundete Gelände soll seine Form erkennen lassen,
   während aktuell unsichtbare Gegner verborgen bleiben. In Screen 27 ist außerhalb des
   kleinen Sichtflecks kaum Orientierung möglich. Die Sichtkante soll runder wirken.
   Helligkeit und Filterung brauchen einen Bildvergleich; Opus' erster Zahlenvorschlag
   von 0,55 war keine gemessene oder bereits geprüfte Lösung.
2. **Startausschnitt und Massepunkte:** In Screens 09, 41 und 42 dominieren grüne Textur
   und große Neonringe. Eine weiter entfernte Startkamera, sichtbare Kartenmerkmale und
   dezente Bodenmarkierungen würden die Orientierung verbessern. Ein fester Faktor für
   den Kameraabstand ist noch nicht qualifiziert.
3. **Bausymbole und Preview:** Die kleinen blauen Glyphen in Screens 10 und 18 sind ohne
   Beschriftung schwer zu unterscheiden. Eigene Silhouetten und Klassenfarben sowie
   ein halbtransparentes Gebäudemodell als Baupreview würden die Auswahl erleichtern.

Minimap und Unit-Porträts bleiben ausdrücklich ausgeschlossen. Die Änderungen sollen
das kompakte HUD beibehalten und keine zusätzlichen Dauerpanels schaffen.

## Beschlossenes nächstes Arbeitspaket

**Upgrade-Abbruch ohne versteckte Pause.** Opus hat seinen ersten Vorschlag, mehrere
unabhängige Baustellen zusammenzulegen, nach der Gegenprüfung zurückgenommen.

Der Designvorschlag sitzt im expliziten HUD-Upgrade-Abbruch: Für eine kontrollierbare,
pausierte Upgrade-Einheit zuerst Stop senden und anschließend Fortsetzen. Generischer
Stop und absichtliches Pausieren anderer Arbeit bleiben unverändert. So braucht der
Fix keine Änderung der Sim-Regeln für alte Replays. Weil Upgrade-Pause und allgemeine
Pause dasselbe Flag nutzen, muss die Beschriftung erklären, dass der Abbruch die Einheit
fortsetzt. Die genaue Umsetzung ist noch nicht begonnen.

Abnahmekriterien:

1. ACU und T1-Mex: Upgrade → Pause → Abbruch ohne vorheriges Fortsetzen hebt die Pause
   auf und stellt Einkommen sowie nutzbare Baukraft wieder her. Ein danach beauftragtes
   Landwerk wird tatsächlich fertig.
2. Manuelle Pause plus generischer Stop lässt die manuelle Pause bestehen.
3. Die vorhandene öffentliche Aufnahme bleibt ohne Replay-Divergenz; eine neue Aufnahme
   der korrigierten Folge enthält Stop vor Fortsetzen und spielt ebenfalls korrekt ab.
4. Eigene pausierte Einheiten zeigen ohne Öffnen der Details „Pausiert“ und einen
   beschrifteten Fortsetzen-Button, lesbar bei 1440×900 und 1280×720.
5. Der Upgrade-Pausezustand erklärt sichtbar, dass Eigenproduktion und Baukraft ruhen.
6. Die Statusdokumentation nennt den neu geprüften Vertrag und seine tatsächlichen Grenzen.

Danach empfiehlt Opus drei getrennte Pakete:

1. Schlachtfeld-Lesbarkeit: Kamera, erkundetes Gelände, Sichtkante, Massepunkte und Glyphen.
2. Ergebnisstatistik: zuerst festlegen, wo echte kumulative Daten erfasst werden; aktuelle
   Armee-/Frame-Werte liefern keine gesammelten, gebauten oder verlorenen Gesamtzahlen.
3. Gefechtssetup, Texte und unvollständige Bedienelemente.

## Grenzen des Reviews

Keine neue Performance-Abnahme, keine Prüfung in Firefox/WebKit, keine subjektive
Soundprüfung und kein Bewegungsvideo. Frischer Sieg/Unentschieden, fertig ausgebaute
T2/T3-Mex sowie Kampf und KI-Verhalten waren nicht als vollständige neue Spielabläufe
Teil der Aufnahme. Die Replay-HUD-Uhr „00:00“ am aufgezeichneten Ende bleibt
Prüfbedarf; daraus wurde kein bestätigter Zeitberechnungsfehler abgeleitet.

Die vorhandenen funktionalen Integrationsbelege werden durch dieses Review nicht
pauschal verworfen. Die Aussage, pausierte Upgrades ließen sich ohne Folgeproblem
abbrechen, ist jedoch zu weit gefasst. Ebenso bedeuten angeschlossene Glyphen noch
keine gute Unterscheidbarkeit und ein bestandener Spielstart noch keine vollständig
qualifizierte Runde. Diese Unterschiede bestimmen die nächste Umsetzung.
