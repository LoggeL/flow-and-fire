# Opus-Fixes 2026-10-01

Stand: lokaler Arbeitsbaum auf Basis `c576c5c`, nicht committet, nicht deployt. Diese Datei hält nur
Ergebnisse fest, die lokal geprüft wurden; Belege liegen unter `test-results/opus-implementation-20261001/`.
Eine Deployment-Abnahme ist damit nicht erfolgt.

## Prüfungen (seriell, Abschlussstand)

| Prüfung | Ergebnis |
|---|---|
| `pnpm typecheck` | bestanden |
| `pnpm lint` (eslint, depcruise) | bestanden, 0 Warnungen, 0 Abhängigkeitsverstöße |
| `pnpm test` (vitest) | 336 Dateien, 3339 Tests bestanden |
| Originalaufnahme `current-public-match.rtsreplay` gegen ms6.2 (vor Identitätswechsel) | 255 Regel-Hashes, 25 Tabellen-Hashes, 0 Abweichungen (`public-replay-verify.json`) |
| Originalaufnahme gegen ms6.3 | wird nicht abgespielt, sondern mit `ReplayCompatError` auf `/b/48ecd86e71a1/` verwiesen; SHA-256 `bb448a40…` unverändert (`public-replay-route.json`) |
| Stumme Browserbelege (Chromium, `installSilentOutput`/`assertSilentOutput` vor jeder Navigation) | `screens/*.png`, `shots-manifest.json`, `motion.json` |

Nicht gelaufen: die Playwright-Specs unter `test/e2e`, Firefox/WebKit, Timing-Gates, lange KI-/GPU-Kampagnen.

## 1 Upgrade-Abbruch

- Expliziter HUD-Abbruch eines pausierten, steuerbaren Vogt-/Extraktor-Ausbaus sendet `Stop` und danach
  `TogglePause(false)`; ein laufender Ausbau nur `Stop`. Generischer Stopp und Sim-Regeln unverändert.
- Knopf „Abbrechen + fortsetzen“ mit Erklärung; Pausehinweis nennt ruhende Produktion/Baukraft.
- Eigene pausierte Auswahl zeigt sofort „Pausiert / Fortsetzen“, auch bei Mehrfachauswahl, nur eigene
  Einheiten, nicht im Replay.
- Beleg: `apps/game/test/upgrade-cancel-resume.test.ts` (echte HeadlessSim: Ausbau → Pause → Abbruch,
  Wirtschaft wieder aktiv, danach vollständiger Fabrikbau; generischer Stopp behält manuelle Pause;
  Aufnahme + Wiedergabe der Folge `Upgrade, TogglePause, Stop, TogglePause, Build` ohne Abweichung).
  Screens `p1-*`.

## 2 Schlachtfeld und HUD

- Startkamera 135 WU bei ≥ 900 px Fensterhöhe, darunter proportional bis 105 (Vergleich 105/135/165:
  `cmp-camera-*`).
- Erkundetes Gelände 0,5 Helligkeit mit kühler Tönung (Vergleich 0,35/0,5/0,6: `baseline-*`, `fog050-*`,
  `fog060-*`); Sichtkante bikubisch gefiltert und weich. Feinde außerhalb der Sicht bleiben verborgen.
- Massepunkte als dezente Bodenplatte mit dünnem Ring; Auswahl als dünner Rand statt Einfärbung.
- Bauglyphen mit SVG-Silhouetten und Klassenfarben, Tech-Markierung; Baupreview als halbtransparentes Volumen.
- Fabrikpanel bei 1440×900 und 1280×720 ohne Überlauf (`p2-factory-queue-*`); Kontrollgruppen beschriftet,
  dabei einen bestehenden Fehler behoben (Leiste war um eine Ziffer verschoben).

## 3 Ergebnis und Statistik

- Neuer Host-Beobachter `packages/sim-host/src/match-stats.ts` zählt aus bestätigten Ticks; Sim-, Log- und
  Replay-Layouts unverändert. Auslieferung einmalig nach Partieende (`MatchStatsMsg`).
- Ergebnisfenster für Sieg, Niederlage und Unentschieden; nur erfasste Werte; fehlende Daten werden als
  „wird abgeschlossen“, „nicht erfasst“ oder „teilweise“ gekennzeichnet. Im laufenden HUD keine Feinddaten.
- Letzte Partie im Hauptmenü, Revanche, „Replay ansehen“ öffnet die beendete Partie.
- Gefundener Fehler: der Worker-Link verwarf die neue Nachricht; behoben, mit Test.
- Belege: `match-stats.test.ts`, `score.test.ts`, Screens `p3-*`.

## 4 Setup, Menüs, Settings, Texte

- Farben und Teams entsprechen den Optionen (Team intern 0-basiert, Anzeige +1); Kartenvorschau aus echten
  Höhen/Wasser und Spots; KI-Stufen mit AIx-Faktor beschriftet; keine rohen IDs, kein C20/MVP.
- Settings: lesbarer GPU-Name, „Voreinstellung empfehlen“ aus GPU/Kernen (keine Messung), nur unterstützte
  AA-/Splat-/Schatten-Werte, Tooltips an/aus wirksam, Tastenübersicht mit Aktionen. Ein kaputter
  gespeicherter Einzelwert fällt einzeln zurück; Altwerte werden abgebildet.
- Hauptmenü ohne Zurück, Build-Metadaten, Einweisung und Credits im Menüstil.
- Fehler lokalisiert, nach 5 s und beim Screenwechsel gelöscht; Hotkeys verborgener Karten ignoriert;
  „Speicher voll“ erst nach vorherigem freien Lager; Begriffe vereinheitlicht.
- Belege: `menu-data.test.ts`, `session-settings.test.ts`, `hud-alerts.test.ts`, `hud-live.test.ts`; Screens `p4-*`.

## 5 Replay

- Panel im HUD-Stil, de/en; Prüfstatus „läuft“, bis Hashes verglichen sind.
- Bibliothek mit Suche, Umbenennen (Anzeigename lokal, Aufnahmebytes unverändert) und Löschen mit Rückfrage;
  bestehende Aufnahmen bleiben lesbar.
- Alle-Armeen-Ansicht ohne Schein-Ressourcen; Uhr nach Seek/Rücklauf sofort richtig.
- Build-Archiv (`deploy/release-archive.mjs`) und Audio-/Session-Dispose unverändert.
- Belege: `replay-panel.test.tsx`; Screens `p5-*`.

## 6 Inhalt

- Landwerk I → II → III als bezahlter Ausbau; während des Ausbaus ruht die Produktion, Stopp bricht nur den
  Ausbau ab. T2-/T3-Einheiten über Kategorien an die passende Stufe gebunden; die Produktionskarte zeigt alle
  baubaren Einheiten mit eindeutigen Hotkeys.
- Neu im normalen Angebot: Geschützturm `core:str_t1_pd` (Z) und Radar `core:str_t1_radar` (D, Reichweite 116,
  20 E/s). Radar zeigt Feinde außerhalb der Sicht als Blip-Symbol, ohne HP-Balken, nicht anwählbar.
- `SIM_BUILD` → `faf-sim/ms6.3-factory-tiers-radar`, simHash `0x249a86a9`; Goldens über die Update-Skripte
  erneuert; alte öffentliche Buildbytes und Aufnahmen nicht überschrieben.
- Bewegung/Rig/Cursor/Favicon stichprobenartig geprüft: Laufzyklus pendelt, Turm-Gierwinkel zeigt auf den
  Gegner, Bewegungs-/Baucursor gesetzt, Favicon 200 `image/png` (`motion.json`, `p6-motion-*`).
- Belege: `factory-radar-defense.test.ts`, `factory-upgrades.test.tsx`, Blueprint-/Simbin-/Render-Tests;
  Screens `p6-*`.

## Grenzen und offene Punkte

- Die Existenz von `/b/48ecd86e71a1/` auf dem Server wurde nicht geprüft; geprüft ist nur der Verweis.
  Neue Partien sind mit ms6.2-Clients nicht abspielbar (gewollter Identitätswechsel).
- Radar-Blips übertragen im Frame den Blueprint-Index (für den Culling-Radius). Das HUD zeigt nichts davon,
  im Datenstrom ist der Typ aber lesbar.
- Werte für Geschützturm (1350 HP, 240 M/2000 E, Waffe Reichweite 24, 45 Schaden, 1,2 s) und Radar (200 HP)
  sind gesetzt, nicht balanciert; einzelne Namen/Werte weichen vom Roster-Dokument ab.
- `packages/sim/test/zz-debug.test.ts` enthält einen echten PD-Zielprioritätstest, sollte aber umbenannt
  werden (Löschen/Umbenennen war in dieser Sitzung nicht möglich).
- `screens/p2-failure.png`, `p3-failure.png`, `p5-failure.png` sind Fehlbilder früherer Läufe.
- Playwright-E2E nicht ausgeführt; Bildbelege nur in Chromium.
- Keine Timing-Aussagen: keine Gates, keine Frame-Budget-Messung.
