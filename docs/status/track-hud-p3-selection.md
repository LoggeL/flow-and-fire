# TRACK-HUD p3: Auswahl und Produktionsqueue

Stand 2026-09-29 im kanonischen Projekt.

`SelectionPanel` bietet leere, einzelne, mehrfache und Fabrikauswahl. HP, Veteranenfortschritt, Abstechen-Ladung, Produktionsfortschritt und Restzeit sind Signal-Bindungen. Die Mehrfachauswahl hat höchstens 24 Typkacheln und 60 Einheitsknoten; bei größeren regulären Auswahlen zeigt die Demo nur Typkacheln. Die FactoryQueue übergibt Hinzufügen, Entfernen, Wiederholen, Pause, Sammelpunkt und Leeren an Commands.

Die Tests prüfen Strg-Kachel-Auswahl und Umschalt-Rechtsklick zum Entfernen von fünf Queue-Einträgen. Queue-Aggregation und Auswahlstatistik bleiben reine Funktionen. Galerie und volle Browsernachweise: [track-hud.md](track-hud.md).

Das feste Dock begrenzt die intrinsische Höhe der Panels. Lange Kachel-/Einheitslisten scrollen innerhalb des Auswahlbereichs statt das Dock aus dem Viewport zu drücken. Porträts verwenden strategische Icons. Die Anbindung realer Auswahl-/Vet-/Schilddaten bleibt beim Spieladapter.
