# Forged-Alliance-HUD am 1. Oktober 2026

Die beiden vom Nutzer bereitgestellten Supreme-Commander-Screens bestimmen das Layout:
Ressourcen oben links, Status oben rechts, Auswahl über den Befehlen unten links und
eine horizontale Bauliste rechts daneben. Es gibt weiterhin keine Minimap und keine
Porträts ausgewählter Einheiten.

Die Rahmen haben abgeschrägte Stahleinfassungen, kleine Fugen, einen dunklen Metallgrund
und einen hellblauen Innenrand. Die Geometrie besteht aus CSS. ImageGen hat ausschließlich
die Metalloberfläche erzeugt; die 17 unterschiedlichen Bilder der Baukandidaten stammen
aus den tatsächlichen Varkan-Modellen. [Material, Quellen und vollständiger Prompt](../ui-assets/supcom-material-v1.md).

Opus 5.5 hat Layout und Rahmen implementiert. Die abschließende Integration ergänzt
die Modellbilder, korrigiert die Positionierung der oberen Anzeigen und prüft die
Spielabläufe. Die Links-/Rechts-Tasten sowie Home/End navigieren durch die Bauliste.
Details öffnen nach oben; belegte Kontrollgruppen, Ausbau und Fabrikwarteschlange
liegen über der Bauliste. Bei schmalen Listen sind Scrollpfeile sichtbar.

[Vorher/nachher im gleichen 1440×900-Viewport](comparison.html).

## Prüfung

- Typprüfung und vollständiger Lint bestanden, keine Abhängigkeitsverstöße.
- 39 betroffene Tests in sieben Dateien bestanden.
- Chromium-Specs für tatsächliche ACU-Upgrades sowie Cursors, Bau und Fabriksteuerung:
  beide bestanden. Die Layout-Erwartungen prüfen jetzt Auswahl über Befehlen und die
  horizontale Bauliste. Das Spielfeld oberhalb des Docks bleibt anklickbar.
- Sechs Zustände an vier Größen (1440×900, 1280×720, 1024×768, 800×600): 24 Layoutprüfungen
  und insgesamt 33 Screens bestanden. ACU, pausierter Ausbau, fertige Fabrik, belegte
  Warteschlange, Mehrfachauswahl und geöffnete Fabrikdetails bleiben im Viewport.
- Native Befehle statt injizierter Einheiten: Ausbau abbrechen, anschließend Fabrik
  fertigstellen, Rally setzen, Ingenieur und Panzer einreihen, Ingenieur fertigstellen,
  mehrere Einheiten auswählen, im Pausemodus aufgeben und Replay prüfen.
- Kein Seitenfehler und keine fehlgeschlagene HTTP-Antwort. Aufnahme unverfälscht;
  alle Echtzeit-Audiokontexte vor der Navigation abgesichert, null Lautsprecherverbindungen.

Lokale Originalbelege: `test-results/supcom-ui-20261001/`, darunter der Opus-Auftrag und
sein Abschluss, `browser/receipt.json`, die PNGs und die Playwright-Ergebnisse.
Firefox und WebKit wurden für diese UI-Lieferung nicht erneut qualifiziert. Die
Spielregeln und Sim-Identität bleiben unverändert; alte Builds werden beim Docker-Update
im Replay-Archiv erhalten.

## Öffentliche Lieferung

Build `6753e2636876` (Quellstand `6753e2636876eff482a20501d8c94c152146430a`) läuft als
`flow-and-fire:6753e2636876` auf der HomeBox unter [faf.logge.top](https://faf.logge.top/?menu=1).
Der Container ist gesund und hat null Neustarts. Derselbe native Ablauf bestand
öffentlich erneut mit 24 Layoutprüfungen und 33 Screens, ohne Seiten-/HTTP-Fehler
oder Lautsprecherverbindungen. Das neue Replay ist bei Tick 100 sauber.
Beleg: `test-results/supcom-ui-20261001/public/receipt.json`.

Die frühere Adresse bleibt als Alias erhalten. Der archivierte vorherige Build
`7fc3bcf2cc72` liefert seine ursprünglichen Replay-Fähigkeiten mit HTTP 200.
README und Vorher-/Nachher-Vergleich verwenden den öffentlichen Screenshot dieser Lieferung.
