# Zweites Modell-Subset: Gebäude und Animationen

Sechs spielbare Varkan-Gebäude sind detaillierter ausgearbeitet und im Spiel integriert. Tragwerke, Panzerplatten, Kühler, Leitungen, Lager, Rampen und Waffenmechanik ergänzen die vorhandenen Modelle. Die neuen Details liegen auf den bisherigen beweglichen Teilen; Maßstab, Grundfläche, Teamfarben und Gelenke sind erhalten.

[Vorher-nachher-Vergleich](review.html), [Geometrienachweis](review-receipt.json) und [Browsernachweis](runtime/summary.json). Die Bilder zeigen die tatsächlichen GLB-Exporte mit gleicher Kamera. Das erste Subset mit sieben mobilen Einheiten bleibt erhalten: [erstes Review](../model-detail-subset-2026-10-02/README.md).

| Modell | Dreiecke vorher LOD 0/1/2 | Jetzt LOD 0/1/2 | Lokales Budget | Bewegung im Spiel |
|---|---|---|---|---|
| Landwerk I | 268 / 162 / 64 | 2988 / 422 / 64 | 4000 / 1000 / 300 | Scharniertor bei Produktion |
| Landwerk II | 308 / 182 / 82 | 3440 / 272 / 96 | 4000 / 1000 / 300 | Scharniertor bei Produktion |
| Zapfstelle I | 234 / 64 / 54 | 1606 / 64 / 54 | 2200 / 600 / 180 | Pumpenkopf bei Betrieb |
| Zapfstelle II | 276 / 106 / 54 | 2596 / 282 / 126 | 2600 / 700 / 220 | Pumpenkopf bei Betrieb |
| Horcher I | 250 / 174 / 58 | 1582 / 310 / 74 | 2400 / 650 / 200 | Drehende Sensorgruppe |
| Riegel I | 286 / 130 / 74 | 1782 / 192 / 80 | 2400 / 650 / 220 | Turm und Rohr richten sich aufs Kampfziel |

Die LOD-0-Geometrie hat je nach Modell 6,2 bis 11,2-mal so viele Dreiecke. Diese Zahlen beschreiben den Geometrieumfang. Die Standardbudgets und die übrigen Modelle bleiben unverändert. Die gemeinsame Hilfsgeometrie der weiteren Fabriken und Extraktoren wurde ebenfalls beibehalten.

## Verhalten

Die neuen Animationen laufen im normalen Spielrenderer über akzeptierte Simulationsframes. Ein Fabriktor öffnet bei tatsächlich bezahlter Produktion bis etwa 80 Grad und schließt nach abgeschlossener Produktion im Leerlauf. Die Pumpenköpfe schwingen um höchstens 5 Grad. Das Radar dreht sich bei bezahltem Betrieb. Die vorhandene Waffensteuerung bewegt den Turm und das Rohr der Punktverteidigung unabhängig vom Gebäuderumpf.

Individuelle Pause, fehlender Ressourcenfluss und unvollständiger Bau halten die Betriebsbewegung an. Globale Pause hält sie durch den unveränderten Simulationstick an; ein ausdrücklich weitergeschalteter Tick kann die beobachtete Bewegung fortsetzen. Beim Fortsetzen entsteht kein Aufholen vergangener Wandzeit. Ausgelassene Vorwärtsframes halten den bekannten Strukturzustand fest und führen höchstens den aktuell beobachteten bezahlten Betriebsschritt aus; Tor und Betriebsphase springen dabei nicht zurück. Ohne öffentliche Betriebsdaten bleiben gegnerische Strukturen statisch. Spielregeln, Simulationshash und veröffentlichte Frame-Daten wurden nicht verändert.

Der 3D-Viewer zeigt auf Wunsch eine Demonstrationsbewegung der Teile. Die Spielaufnahmen und Browsernachweise dokumentieren dagegen tatsächliche Produktion, Betrieb und Kampf im Spiel.

## Prüfung

Geometriebasis: Commit `94e3029c946be087a2d0ada075b83b148b1e3231`. Geprüfter Spielbuild: `0a7920400419`, aus Commit `0a7920400419` mit dem Fix für ausgelassene Vorwärtsframes. Simulationshash: `0x02629d13`.

- Alle 220 Modelle exportiert und validiert. Genau sechs Varkan-Modellhashes geändert; die ersten sieben detaillierten Modelle bleiben erhalten.
- 596 Modell-, Asset- und Rig-Prüfungen bestanden. Dazu gehören feste Geometrie-Baselines, unveränderte Gelenke, Budgets, gültige Normalen, abgestufte LODs und Bewegungszustände.
- Typecheck, Lint und Produktionsbuild bestanden.
- Zwölf echte Browserfälle in Chromium, Firefox und WebKit bestanden, ohne übersprungene oder wiederholte Fälle. Beide Fabriktore folgen bezahltem Fortschritt, halten bei Pause und schließen nach echter Produktfertigstellung. Beide Fabriken öffnen außerdem im echten unpausierten Betrieb vollständig und bleiben bei weiter steigendem Baufortschritt offen. Beide Pumpen decken den vollständigen Bewegungsbereich ab; das Radar zeigt 26 verschiedene Winkel über 26 akzeptierte Frames. Unfertige Fabrik, globale Pause, individuelles Fortsetzen, private gegnerische Strukturen, PD-Kampf und die bisherigen Gang- und Waffenbewegungen sind geprüft.
- Alle sechs Vergleichspaare und alle sechs Viewer mit LOD- und Animationseinstellungen geprüft. Keine Seiten-, Konsolen- oder HTTP-Fehler.

Ressourcenstillstand ist in den Rig-Tests abgedeckt. Die nativen Browserfälle prüfen bezahlten Betrieb und die genannten Zustände. Die Nahaufnahme-Szenen verwenden ausdrücklich markierte native Spawn-Befehle für die Gebäude. Die Animationen und die Fabrikproduktion verwenden anschließend die tatsächlichen Spielpfade. Diese Szenen prüfen keine reguläre Bau- oder Technologieabfolge.

Automatisierte Spieltests leiten jeden Echtzeit-Audiokontext vor dem Seitenstart auf einen ungenutzten MediaStream um. Die Nachweise der neuen Browserfälle zeigen je einen Kontext und einen stillen Ausgang sowie null Lautsprecherverbindungen und null blockierte Verbindungen. Es wurde kein Ton abgespielt.

Die JSON-Nachweise liegen unter `runtime/{chromium,firefox,webkit}`. Einzelne direkt nach einem akzeptierten Resume-Tick erfasste Testbilder können noch einen verzögert aktualisierten HUD-Pausehinweis tragen. Die JSON-Nachweise enthalten den akzeptierten Zustand; die Animationsclips zeigen das laufende Spiel.

## Lokal ansehen

- [Vergleichsseite](http://127.0.0.1:5357/review.html)
- [Spiel](http://127.0.0.1:5295/?menu=1)
- [3D-Viewer](http://127.0.0.1:5356/#/model/varkan/str_t2_fac_land)

Die Server lassen sich aus dem Projektordner erneut starten:

```sh
pnpm --filter @faf/game serve --port 5295 --coi
pnpm --filter @faf/model-viewer dev --host 127.0.0.1 --port 5356
python3 -m http.server 5357 --bind 127.0.0.1 --directory docs/design/model-activity-subset-2026-10-02
```

Der Review-Stand liegt auf `codex/model-detail-animation-subset`. Der öffentliche Build wurde für diese Runde nicht verändert.
