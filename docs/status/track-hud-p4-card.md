# TRACK-HUD p4: Command Card, Hotkeys, Gruppen

Stand 2026-09-29 im kanonischen Projekt.

Die Command Card wird aus den generierten Roster-/Bautabellen abgeleitet. Tech-Tabs ändern die Stufe an festen Rasterpositionen. `OrderBar`, `OrderButton`, `OrderTooltip`, `SelectionFilter`, `IdleButton` und `ControlGroups` nutzen die typisierten Command-Verträge.

35 unabhängige Matrixfälle prüfen Alt-Raster, Befehlseiten, WASD-Kamera, Strg+Entf/Backspace, Modal-/Textfokus und den Ausschluss von B/Alt+B für Selbstzerstörung. Ein DOM-Test prüft die tatsächliche Hotkey-Weiterleitung. Die Alt-Behandlung lässt Textfelder und Modals ihre Eingaben behalten.

Kurznamen dürfen umbrechen. Die Plex-Zeilenhöhe ist bei 1,25-Skalierung groß genug für akzentuierte Pseudo-Texte. Vollständige Nachweise und Roster-Tests: [track-hud.md](track-hud.md). Rebinding ist entsprechend C20 gesperrt.
