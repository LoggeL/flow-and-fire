# TRACK-HUD p5: HUD, Minimap, Scheduler

Stand 2026-09-29 im kanonischen Projekt.

`Hud` fügt die Panels, Tooltip-Schicht und Esc-Menü zusammen. `computeUiScale` begrenzt die Skalierung auf 0,8 bis 1,5. Die Galerie enthält 1080p, 1440p bei 1,25 und 1,0 sowie 720p bei 0,8.

Die Minimap hat getrennte Canvas-Lagen für Gelände, dynamische Daten und Kamerarahmen. Ressourcen, Nebel, Blips, Ghosts und Pings stammen aus deterministischen Demos. Isolierte Minimap-Stories haben dieselbe feste Canvasfläche wie das Dock. Der Browser-Interaktionstest prüft alle drei sichtbaren Canvas-Lagen und einen sichtbaren Moduswechsel.

Der Scheduler bündelt Frames und verwendet 100/250/500/1000 ms an der Wanduhr. Er pausiert laufende Daten, lässt Ereignisse durch und schreibt gleiche skalare Werte nicht erneut. Neue Wrapper für wiederverwendete Typed Arrays benachrichtigen ihre Signal-Empfänger auch bei gleicher Bufferidentität. Tests prüfen ×3, Pause, Bündelung, Disposal und die Bufferveröffentlichung.

Node- und Browsermessung sind getrennt. Die vollständigen Messwerte, Grenzen und Übergaben stehen in [track-hud.md](track-hud.md).
