# TRACK-HUD p2: Ressourcen, Status, Alerts, Tooltips

Stand 2026-09-29 im kanonischen Projekt `flow-and-fire`, Branch `main`.

`ResourceMeter`, `ResourceBar`, `FlowDetails`, `MatchStatus`, `PauseBanner`, `AlertFeed`, `Alert`, `UnitTooltip` und `ResourceTooltip` sind Preact-Komponenten. Die Modellfunktionen unterscheiden Überlauf, drohenden Stall und anteiligen Flow, sortieren Verbraucher, fassen Alerts innerhalb ihres Wiederholintervalls zusammen und verschieben abgelaufene Alerts in den Historienzähler. Die Sprungziele werden als Commands übergeben; das Präsentationspaket entscheidet nicht über Simulation oder Audio.

Die Galerie zeigt die Sollzustände einschließlich Sim-Lag, Context-Loss, pausierten Verbrauchern und Tooltip-Nachbarschaft. Tests prüfen Ressourcen-/Pause-/Tempo-Commands und Alert-Zusammenfassung, das 20-s-Alter sowie Ablauf bei 60 s. Die vollständigen Browsernachweise stehen in [track-hud.md](track-hud.md).

Bei der visuellen Prüfung wurde die durch eine allgemeinere Span-Regel verlorene Flex-Anordnung der Ressourcenraten korrigiert. Der Blinkzustand verwendet reduzierte Bewegung aus dem Modell. Lokale Fake-Daten und Texte sind keine Abnahme einer echten Sim-/Audioanbindung.
