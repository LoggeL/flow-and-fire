# rfx-p5: FX-Lab-Shell

Die Shell in `apps/fx-lab/src/app` umfasst Param-Parsing, 60-Hz-Clock, Szene-/FX-Verträge, Sim-Taktung, Kamera-Rig, Unit-/Props-/Ground-Passes, HUD und Hooks. `scenes/index.ts` registriert lighting/battle/shields/big/gallery; `main.ts` liefert `createLabFx` an die App. Szenenwechsel zerstört den vorherigen FX-Kontext, räumt Units auf und setzt Clock/Seed zurück. Context-Restore setzt Timer zurück und invalidiert den CSM-Cache.

Die öffentliche Diagnose-API ist `window.__fxlab`, beschrieben in `app/hooks.ts`. `SampleRing` speichert 2048 Frames ohne laufende Objektlisten und exportiert Samples erst auf Anfrage. FX-Draws werden pro Frame gespeichert und im Bench gegen 6 geprüft; Gesamt-Draws gegen 40. GPU-Gesamtzeit bleibt null bis alle sechs Segmente des Frames aufgelöst sind.

Parameter und Startbefehle stehen im Track-Dokument. E2E-Preview nutzt den separaten Port 4683, keine bestehenden Server. Der am 29.09.2026 ergänzte Shell-Test prüft reproduzierbares Freeze bei verschiedener Framerate, Stall-Begrenzung/Reset, Sample-Umlauf mit verspäteten GPU-Ergebnissen und Param-Roundtrip/ungültige Eingaben.

Lab-HDR/CSM sind unabhängige Diagnose-Schalter, keine automatische Hardwarewahl. Die spätere Spielintegration folgt den Zieltabellen aus render-fx. Der Lab-Allokationsnachweis ist noch keine vollständig allokationsfreie Szenenlogik; Event-Helfer verwenden kleine temporäre Arrays.
