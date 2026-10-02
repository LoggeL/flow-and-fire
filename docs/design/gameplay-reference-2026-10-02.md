# Forged Alliance: beobachtete Gameplay-Funktionen

Stand: 2. Oktober 2026. Diese Referenz zerlegt öffentlich verfügbare YouTube-Aufnahmen in sichtbare Zustände und Bedienabläufe. Sie ist eine Arbeitsgrundlage für die vorhandenen Funktionen von Flow & Fire. Die Beobachtung erfolgte an lokal extrahierten Videoframes, nicht allein an Beschreibungen oder Transkripten. Es wurde kein Spiel gestartet und kein Ton ausgegeben.

## Quellen und lokale Belege

Alle Zeiten beziehen sich auf das Originalvideo, nicht auf die zugeschnittene Datei. Originaltitel bleiben zur Suche unverändert. Die Clips sind reine H.264-Videospuren ohne Audiospur. Screenshots, Clips und Kontaktbögen liegen ausschließlich im bereits ignorierten Verzeichnis `test-results/gameplay-reference-20261002/`. Fremdes Bildmaterial wurde nicht in Spielassets übernommen.

| Quelle | Autor | Lokal untersuchter Ausschnitt | Zweck |
| --- | --- | --- | --- |
| [Generic Build Orders - FAF Tutorial 1 - Supreme Commander Forged Alliance](https://www.youtube.com/watch?v=_6uE1-xS2uk) | Heaven aka. Penemue | 01:30 bis 04:30, `build-order.mp4` | Bauketten, Gebäude-Geister, Auswahl, Fabrikwege |
| [Supreme Commander Forged Alliance Tutorial #22 - UEF Commander Upgrades](https://www.youtube.com/watch?v=258ZiU5uavc) | TheForgedAllianceColonel | 00:00 bis 04:00, `uef-upgrades.mp4` | Enhancement-Ansicht, Slots, Weltwirkung |
| [Supreme Commander Forged Alliance Tutorial #1 - User-Interface](https://www.youtube.com/watch?v=0QhM7oC-t7U) | TheForgedAllianceColonel | 00:00 bis 04:07, `ui-tutorial.mp4` | Befehlsicons, Baupalette, Ressourcenleisten |
| [SupCom Tutorials! - When do I tech up? Supreme Commander Forged Alliance](https://www.youtube.com/watch?v=c5cTaTKJ5vI) | BRNKoINSANITY | 08:00 bis 10:00 und 12:00 bis 15:00, `tech-up.mp4`, `tech-up-late.mp4` | Spieleransicht, Ausbau und Produktionszustände |

`media-verification.json` bestätigt für alle fünf Clips ausschließlich Videospuren. `frames.py` erzeugt beschriftete Kontaktbögen. Einzelbilder behalten die volle Auflösung von 1280 × 720. Der Dateisuffix ist die Originalposition in Sekunden. Die Download-Schnitte wurden ohne erneute Videokodierung erzeugt, daher sind Zeitangaben als sekundengenaue Suchpositionen zu verstehen, nicht als Messung einzelner Mausklicks.

## Sichtbar geprüfte Funktionen

### Baukette und Befehle mit Shift

Heaven, 01:30 und 02:15: Eine ausgewählte Baueinheit hat mehrere geplante Schritte. Gelbe Verbindungslinien laufen über kleine Wegmarken zu Bauorten. Bei 04:10 stehen mehrere grüne Gebäude-Geister in blauen Grundrissen neben der existierenden Basis. Die Liste bleibt im Gelände lesbar, während der Spieler weiter plant. Die sichtbaren ETA-Texte sind Teil der verwendeten UI-Mods und keine Voraussetzung für unsere Umsetzung.

Ablauf: Builder wählen, Gebäude aus der Palette wählen, mehrere Orte einreihen, die Reihenfolge in der Welt kontrollieren, anschließend ausführen lassen. Die gedrückte Taste ist im Video nicht eingeblendet. Die Zuordnung zu Shift ist zusätzlich durch das [offizielle FA-Handbuch, gedruckte Seiten 4 und 13](https://manuals.thqnordic.com/SupremeCommander/SupremeCommanderFA_OnlineManual_DE.pdf) belegt.

Belege: `build-order-0090.png`, `build-order-0135.png`, `build-order-0250.png`.

### Commander-Enhancements

UEF-Video, 00:00: Die Baupalette ist durch eine Enhancement-Ansicht ersetzt. Drei kleine Slot-Tabs sitzen oberhalb der Modulicons. Das gewählte Modul ist blau; Folgeoptionen können dunkel sein und sind durch Pfeile verbunden. Hover zeigt Wirkung, Masse, Energie und Zeit. Bei 01:40 ist die Rückenoption gewählt. Bei 02:00 ist um die ACU ein transparenter Schild sichtbar. Der sichtbare Körper und seine Zusatzteile bleiben im Gelände erkennbar.

Ablauf: ACU wählen, Enhancement-Ansicht öffnen, Slot wählen, Modul und Wirkung prüfen, Einbau auslösen, Fortschritt und Ergebnis kontrollieren. Die Editor-Overlaytexte des Autors sind von der nativen UI zu unterscheiden. Alte Kosten, Armbenennungen und Balancewerte werden nicht als Vorgabe übernommen.

Belege: `uef-upgrades-0000.png`, `uef-upgrades-0100.png`, `uef-upgrades-0120.png`.

### Fabrik, Produktionsliste und Rally

BRNK, 12:56: Die native Auswahl nennt eine `Tech 1 Land Factory` und zeigt `Upgradeable`. Bei 13:14 bietet die ausgewählte Luftfabrik in ihrer Palette einen `Tech 2 Engineer` an. Bei 13:18 stehen Produktionsblöcke mit Anzahlen in einer eigenen unteren Zeile. Ein cyanfarbener Pfeil verbindet die Fabrik mit einem Ziel außerhalb ihres Grundrisses; bei 13:20 bleibt der Zielmarker dort stehen.

Damit sind die Upgrade-Möglichkeit, die T2-Produktion und der sichtbare Sammelpunkt belegt. Der komplette T1-zu-T2-Einbau derselben Fabrik ist wegen zwischenzeitlicher Kamera- und Auswahlwechsel nicht durchgehend sichtbar. Der Ausstoß einer Einheit bis zum Sammelpunkt wurde nicht verfolgt.

Belege: `tech-up-late-0776.png`, `tech-up-late-0794.png`, `tech-up-late-0798.png`.

### Auswahl, Reichweiten und strategischer Zoom

UI-Video, 00:00: Die ausgewählte ACU hat einen cyanfarbenen Ring unmittelbar am Fuß. Größere Reichweitenkreise haben andere Farben und Radien. Bei 03:20 bleibt die Baupalette am unteren Bildschirmrand kompakt, während der Hauptbereich das Terrain zeigt. BRNK, 08:15 und 08:45: Dieselbe Karte wechselt zwischen fast vollständiger Übersicht mit strategischen Symbolen und naher Terrainansicht mit einer ausgewählten Einheit und gelber Befehlslinie. Das untere HUD bleibt dabei bedienbar.

Belege: `ui-tutorial-0000.png`, `tech-up-0495.png`, `tech-up-0525.png`.

### Fog und Aufklärung: Beobachtungsgrenze

BRNK, 08:15 und 09:15: Die Karte enthält lokale helle Bereiche und strategische Symbole; anderes Terrain wirkt dunkler. Aus diesen Frames allein lässt sich nicht sicher trennen, welche Flächen unaufgeklärt, erkundet oder aktuell im Sichtbereich sind. Deshalb sind sie eine Referenz für Lesbarkeit und lokale Sichtbereiche, kein Beleg für die vollständige Fog-Zustandsmaschine. Gegnerkontakte ohne Sicht sowie deren Verschwinden wurden in diesem Ausschnitt nicht verifiziert.

Belege: `tech-up-0495.png`, `tech-up-0555.png`.

## Abgleich mit Flow & Fire

Der Abgleich ist eine Quellcodeaufnahme während paralleler Arbeiten, keine neue Laufzeitabnahme.

| Funktion | Vorhandene Implementierung | Konkreter Prüfschritt oder begrenzte Lücke |
| --- | --- | --- |
| ACU-Slots | `apps/game/src/hud/LiveCommanderUpgrade.tsx`: linker Arm, Rücken, rechter Arm; installierte Module, Kosten, Fortschritt, Pause und Abbruch | Die reduzierte Auswahl aus Bau-, Waffen- und Panzerungsmodul ist unser eigener Umfang. Ein FA-Schild ist nicht durch bloße Rückenpanzerung nachgewiesen. Slotwechsel darf eine laufende Installation nicht umdeuten. |
| Fabrikausbau | `apps/game/src/hud/LiveFactoryUpgrade.tsx`: Tierwechsel, freigeschaltete Typen, Kosten und Fortschritt; Produktion ruht laut UI während des Ausbaus | Im Spiel prüfen, dass dasselbe Werk seinen Tier und sein Modell wechselt, dann passende Einheiten baut und seine Bauliste behält. |
| Produktionsliste | `apps/game/src/hud/LiveHud.tsx`: aktuelle Einheit, Fortschritt, Blöcke mit Anzahl, Repeat, Pause, Rally; Shift fügt fünf hinzu | Bauliste und aktuelle Produktion müssen bei Auswahlwechsel und Ressourcensperre eindeutig bleiben. Quelle für Shift + fünf ist zusätzlich das offizielle Handbuch. |
| Rally | `packages/client/src/rally-overlay.ts`: cyanfarbene Linie und Zielring aus bestätigten Fabrik-Watches; `hud/live.ts` sendet `SetRally` | Das ist bereits die passende visuelle Trennung zur Baukette. Neue Einheit muss den bestätigten Sammelpunkt erreichen. Mehrstufige Rally-Routen oder Guard-Ziele sind durch diesen Codeauszug nicht qualifiziert. |
| Baukette | `packages/client/src/client.ts` zeichnet akzeptierte Watch-Punkte und Zielscheiben als verbundene Linien. `LiveHud.tsx` ergänzt die bestätigten Baugrundrisse als SVG-Polygone aus `queuedGhosts`. | Bauorte und Reihenfolge sind bereits dargestellt. Das Video zeigt zusätzlich dreidimensionale Gebäudesilhouetten an zukünftigen Bauorten. Diese sind eine mögliche spätere Ergänzung; eine fehlende Grundrissvorschau liegt hier nicht vor. |
| Auswahl/Fog | Auswahldecals im Client; Sichtzustand in `apps/game/src/visibility.ts` | Im Spielerblick testen: Auswahlring gegen dunkles Terrain, tatsächliche Kontakte gegen Radar-Symbole, eigener Builder an Sichtgrenzen. Die Videoanalyse ersetzt diesen Test nicht. |

Die laufende Überarbeitung qualifiziert die vorhandenen bezahlten Upgrades und ihre sichtbaren Ergebnisse. Zusätzliche Gebäudesilhouetten sind als spätere visuelle Ergänzung eingeordnet. Die Videos begründen keine Erweiterung auf sämtliche Fraktionen, Schildsysteme oder die vollständige FA-Einheitenpalette.
