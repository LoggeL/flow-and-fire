# TRACK-HUD p6: Menüs

Stand 2026-09-29 im kanonischen Projekt.

Hauptmenü, Skirmish-Einrichtung, fünf Ladephasen, Esc-Modal, fünf Settings-Tabs und vier Score-Tabs mit Minimalform sind implementiert. Einstellungen besitzen typisierte Werte, Defaults, Presets und Bereichsprüfung. Skirmish validiert Karte, Teams, Farben, Startplätze und Regeln. Startplatzwechsel tauscht den bereits belegten Platz. Score-Graphen verwenden eine gemeinsame y-Skala, eine gestrichelte Gegnerlinie, Endbeschriftungen und einen Fadenkreuzwert.

Tests prüfen Menüfokus, Modal-Fokusfalle/Escape, Bestätigung vor Aufgeben, vollständige Startkonfiguration, blockierten Start, Settings-Werttypen, Live-Sprache, Ladefehler, Replay-Command und bessere Scorewerte. Die Galerie verwendet aufzeichnende Commands mit einem lokalen Demo-Adapter. Numerische Select-Werte bleiben Zahlen, auch wenn der vorherige Wert `auto` oder `monitor` war.

GPU-Autodetect und die Kartendaten sind ausdrücklich Demo-Daten; die Demo-Empfehlung führt keine GPU-Messung aus. Karten-Vorschauen sind prozedurale SVG-Skizzen. Die Menüs folgen Tokens, Klassen und Hauptlayout der Mockups; dekorative Hintergründe und umfangreiche echte Statistiken gehören zur Spielintegration. Nachweise: [track-hud.md](track-hud.md).
