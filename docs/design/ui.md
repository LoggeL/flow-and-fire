# UI/HUD-Designsystem „Gießhalle"

> **Status:** Designkonzept, Stand 2026-09-29. Gilt für HUD und Menüs bis zum Voll-MVP (MS14). Noch nichts davon ist in `packages/client` oder `apps/game` umgesetzt; diese Datei ist die Vorlage für C8/C9/C10/C14/C15/C16/C17 und die Menüs aus A3/A13/P9.
> **Mockups:** [`docs/design/ui-mockups/`](ui-mockups/index.html) – statisch, klickbar, reines HTML/CSS mit wenig Script. Einstieg `index.html`, HUD `hud.html` (Zustände per URL-Parameter, §12).
> **Quellen:** PLAN §2 (Preact + Signals, Minimap Canvas2D), §3.7 (Rendering, Minimap 4 Hz, Alert-Queue), §3.10 (KI), §5 (Meilensteine); `features.json`; `faction.md` §3–§8 (Farben, Icons, Namen, Klang); `roster.json` (Hotbuild-Raster, Werte); `audio.md` + `content/audio/SOUNDLIST.md` (Alerts); `content/icons/` (Strategic Icons); `packages/client/src/{cursor-fsm,actions}.ts` (bestehende Cursor-FSM und Tastenbelegung).
> **Abgrenzung:** keine FA-Grafiken, -Screenshots, -Layouts oder -Namen. FAF dient nur als Maßstab für Komfort (Hotbuild, Idle-Engineer, Queue-Klicks, Alert-Sprung). Formen, Farben, Icons und Texte sind eigene Gestaltung.

---

## 0. Kurzfassung

- **Stil:** dunkles Gusseisen als Fläche, **Glut** (Orange) nur dort, wo Aufmerksamkeit hingehört (aktiv, ausgewählt, Fortschritt, Primäraktion), **Kupfer** für Struktur (Rahmen, Panel-Köpfe, Hover). Ecken sind 45° gefast statt gerundet („gegossen, nicht geschweißt", faction.md §3.1).
- **Dichte wie FA, Lesbarkeit wie heute:** tabellarische Ziffern, feste Spaltenbreiten, kompakte 11–14-px-Schrift in Panels, großzügige 20-px-Zahlen nur für das, was man in 100 ms erfassen muss (Speicher, Netto, Timer).
- **Layout:** Ressourcen oben links, Status und Alerts oben rechts, unten ein Dock aus Minimap | Auswahl | Command Card, darüber eine schmale Leiste mit Filtern, Control Groups und Befehlen. Die Welt bleibt zu ≈ 79 % frei (1080p).
- **Tasten:** Ein 15-Tasten-Raster (QWERT/ASDFG/ZXCVB, physisch) trägt je nach Auswahl Hotbuild, Produktion oder Befehle. Kamera standardmäßig über Pfeile, Rand und Mittelklick; WASD als Schema wählbar (§7.2, Entscheidung UI-E1).
- **Farbe ist nie allein Träger:** Stall = Rahmen + Symbol + Text + Schraffur, Alerts haben je Stufe eine eigene Symbolform, Teams haben einen geprüften farbenblind-sicheren Modus (§8).
- **Performance:** HUD bindet über Signals mit festen Raten (1–10 Hz), schreibt nur `textContent`, CSS-Variablen und Klassen, liest nie Layout im Update-Pfad, animiert nur `transform`/`opacity`. Budget: HUD ≤ 1 ms Main-JS pro Frame (MS4-Abnahme), Minimap ≤ 0,5 ms (MS11).

---

## 1. Leitlinien

1. **Die Welt zuerst.** Das HUD liegt an den Rändern, ist halbtransparent (0,92) und fängt Zeiger nur auf seinen Panels. Nichts HUD-Eigenes schwebt dauerhaft über der Spielfläche außer Alerts und Tooltips.
2. **Glut heißt „jetzt".** Orange ist reserviert für: aktive Auswahl/Tab, laufenden Fortschritt, scharf geschaltete Befehle, Primärknöpfe, Fokus des Spiels. Eine Oberfläche mit mehr als drei Glutflächen gleichzeitig ist falsch gestaltet.
3. **Zahlen stehen still.** Ziffern sind tabellarisch und haben reservierte Breite. Kein Wert verschiebt beim Tick seine Nachbarn.
4. **Ein Ort pro Information.** Eco nur oben links, Auswahl nur im Dock-Mitte, Befehle nur im Raster bzw. der Befehlsleiste. Tooltips wiederholen Werte, erfinden aber keine neuen Orte.
5. **Jeder Zustand hat eine Form.** Hover (Kupferrahmen), gedrückt (dunkle Glut-Fläche), aktiv (Glutrahmen + Glutkante oben), Fokus (Keramik-weißer Rahmen), deaktiviert (Graphit + halbe Deckkraft), gesperrt (Schloss). Siehe §3.7.
6. **Tastatur ist erstklassig.** Jede Aktion der Befehlsleiste und der Command Card hat eine Taste, die auf dem Knopf steht. Menüs sind vollständig mit Pfeilen/Tab/Enter/Esc bedienbar.
7. **Varkan-Stimme, neutrale Mechanik.** Flavor-Wörter (Lotung, Freisprechen, Abstich) stehen in Titeln und Verben, Zahlen und Mechanikbegriffe bleiben neutral (Mass, Energy, Build Power, Reclaim, T1–T3; faction.md §2.3).

---

## 2. Dateien

| Pfad | Inhalt |
|---|---|
| `docs/design/ui.md` | dieses Dokument |
| `ui-mockups/index.html` | Übersicht aller Mockups mit Zustands-Links |
| `ui-mockups/hud.html` + `assets/hud.{css,js}` | In-Game-HUD, alle Zustände über URL-Parameter |
| `ui-mockups/components.html` | Tokens, alle Komponenten mit Zuständen, Cursor, Icons |
| `ui-mockups/{menu,skirmish,settings,loading,score}.html` + `assets/menus.css` | Menüs |
| `ui-mockups/assets/tokens.css` | **Designtokens** (Quelle für `packages/client/src/ui/tokens.css`) |
| `ui-mockups/assets/ff.css` | Basiskomponenten und Zustände |
| `ui-mockups/assets/ff.js` | Mockup-Helfer: Linien-Icons, Zahlenformat, Skalierung, Tabs, prozedurales Platzhalter-Terrain |
| `ui-mockups/assets/strategic-icons.js`, `roster-data.js` | generiert aus `content/icons/svg` und `roster.json` (`tools/gen-data.py`) |
| `ui-mockups/tools/shoot.mjs` | Screenshots mit Playwright (headless Chromium, eigener freier Port) |
| `ui-mockups/tools/cvd-check.py` | Farbenblind-Prüfung der Teampaletten (§8.2) |

Die Welt in den HUD-Mockups ist ein prozedurales Platzhalter-Terrain mit Strategic Icons (Strategic-Zoom-Ansicht). Es stellt nicht das finale Rendering dar.

---

## 3. Designtokens

Alle Werte stehen in `ui-mockups/assets/tokens.css` als CSS-Variablen. Komponenten verwenden **nur Tokens**, nie Rohwerte. Einheit: `1rem = 16 px × UI-Skalierung`.

### 3.1 Farben

**Eisen (Flächen, Text)** – Graphit aus faction.md §4.1, nach oben aufgehellt bis Keramik:

| Token | Wert | Verwendung |
|---|---|---|
| `--iron-1000` … `--iron-850` | `#090807` … `#1b1917` | Seitengrund, Konsole, tiefe Flächen |
| `--iron-800` / `--iron-700` | `#221f1c` / `#2e2b29` | Zellen, Buttons (Body-Material) |
| `--iron-600` / `--iron-500` | `#3b3632` / `#4e4741` | Linien, Rahmen |
| `--iron-400` … `--iron-200` | `#6b625a` … `#b5ab9e` | neutrale Grafik |
| `--ceramic-100` / `--ceramic-50` | `#cfc6b4` / `#ede6d6` | Tech-Kerben, Fokusrahmen, Icon-Glyphen |
| `--surface-0` | `rgba(14,13,12,.92)` | HUD-Panel (ohne `backdrop-filter`) |
| `--surface-1/2/3` | `#1b1917` / `#221f1c` / `#2a2623` | gestufte Flächen |
| `--surface-hover` / `--surface-press` / `--surface-select` | `#332e2a` / `#3b1f0e` / `#3a210f` | Zustandsflächen |
| `--line` / `--line-strong` / `--line-copper` | `#3b3632` / `#4e4741` / `#7a4424` | Trennlinien, Panelrahmen |

**Glut und Kupfer:** `--ember-900 #4a1d06` · `-800 #6a2a08` · `-700 #a4460f` · `-600 #d4621a` · **`-500 #ff8a2a`** (Glut-Falloff) · `-300 #ffb467` · `-100 #ffd9a0` (Glutkern) · `--whiteheat #ffe9c0`. Kupfer `--copper-800 #4a2a17` · `-700 #7a4424` · **`-500 #b06a3b`** · `-300 #d4955f`; Grünspan `--verdigris-500 #4f8c7a` / `-300 #7fb9a5` (nur für Nachbarschafts-Hinweise, E11).

**Ressourcen:** `--mass #7fd1b2` (Grünspan hell, Glyphe Raute) · `--energy #ffd24a` (Weißglut-Gelb, Glyphe Flamme). Beide auch als `-dim` und `-bg`. Die Systematik aus faction.md §6.3 gilt auch im HUD: **Raute = Mass, Flamme = Energy**.

**Semantik** (reserviert, nie für Serien oder Teams): `--ok #8fd18b`, `--warn #ff9f43`, `--crit #ff5a45`, `--info #8fb8e8`, `--neutral-blip #9a9a9a`. Jede Semantikfarbe hat eine eigene Form (§8.1).

**Text:** `--text-hi #f1ebdf` (15,9 : 1 auf Panel), `--text #d9d1c3` (12,4 : 1), `--text-mid #a89e90` (7,1 : 1), `--text-lo #8a8074` (4,9 : 1), `--text-off #574f47` (nur deaktiviert, 2,3 : 1). Kontraste gemessen gegen `#131110` (Panel über dunkler Welt).

**Teams:** Hausfarben aus faction.md §4.3 (`--team-rot` … `--team-oliv`) und die farbenblind-sichere Palette `--cvd-*` (§8.2). Komponenten nutzen nur `--team-self` / `--team-enemy` bzw. `--team` pro Element; der Modus schaltet über `:root[data-teams]`.

### 3.2 Typografie

| Rolle | Schrift | Hinweis |
|---|---|---|
| UI, Zahlen | **IBM Plex Sans Condensed** 400/500/600/700 | OFL, selbst gehostet unter `/b/<hash>/fonts/`, Subset Latin + Latin-1 + Pfeile, `font-display: block` + `preload`. Tabellarische Ziffern (`tnum`). |
| Display (Titel, Banner) | dieselbe Familie, 700, Versalien, Sperrung 0,06–0,24 em | keine zweite Display-Schrift |
| Konsole, Tastenkappen | **IBM Plex Mono** 400/600 | |

In den Mockups greift die Fallback-Kette (`Avenir Next Condensed`, `Roboto Condensed`, `Arial Narrow`), weil keine Schriftdateien eingecheckt sind. Screenshots zeigen daher Avenir Next Condensed.

| Token | Größe @1,0 | Verwendung |
|---|---|---|
| `--fs-micro` | 11 px | Tastenbeschriftung, Badges, Metazeilen |
| `--fs-cap` | 12 px | Panelwerte, Tooltips-Raster, Legenden |
| `--fs-data` | 13 px | Zahlen in Tabellen, Status |
| `--fs-body` | 14 px | Fließtext, Alert-Titel |
| `--fs-label` / `--fs-h3` | 16 / 18 px | Tooltip-Name, Einheitenname |
| `--fs-num` | 20 px | Speicher, Netto, Timer |
| `--fs-h2` / `--fs-h1` / `--fs-logo` | 28 / 40 / 72 px | Menüs |

Regeln: Zahlen immer mit Klasse `num` (tabellarisch); DE-Zahlenformat (`1.230`, `28,0`); Vorzeichen als echtes Minus `−`; Einheiten klein und gedimmt hinter der Zahl (`2.840 / 4.900`). Layouts werden gegen die **deutsche** Textlänge gebaut und mit Pseudo-Lokalisierung (+30 %) geprüft (P12).

### 3.3 Abstände und Maße

4-px-Raster: `--sp-0 … --sp-7` = 2, 4, 8, 12, 16, 24, 32, 48 px. HUD-Maße bei Skalierung 1,0:

| Token | Wert | |
|---|---|---|
| `--hud-gutter` | 8 px | Abstand zum Bildrand |
| `--hud-top-h` | 60 px | Höhe Ressourcenleiste |
| `--hud-dock-h` | 220 px | Höhe Dock |
| `--hud-minimap` | 216 px | Minimap-Panel (quadratisch) |
| `--hud-card-w` | 324 px | Command Card |
| `--cell` / `--cell-gap` | 58 / 4 px | Rasterzelle |
| `--btn-order` | 40 px | Befehlsknopf |

### 3.4 Formen

- **Fase statt Rundung:** Panels (`--chamfer-m` 8 px) und Zellen/Buttons (`--chamfer-s` 4 px) sind oben links und unten rechts um 45° gefast, Menü-Karten 14 px. Umsetzung per `clip-path` mit einem Pseudo-Element als Innenfläche (Rahmen = Außenfläche). Statisch, also ohne Laufzeitkosten.
- Rundungen nur für Zähl-Badges (Pille) und Punkte.
- Panel-Kopf (`.ff-ph`): 24 px, Versalien 11 px, Kupfer-Raute als Marker, rechts Meta-Text.

### 3.5 Ebenen (z-index)

`--z-world 0` (WebGL-Canvas) · `10` Welt-Overlays im DOM (Auswahlrahmen) · `20` HUD · `30` Alerts · `40` Tooltip · `50` Modal (Esc-Menü, Einstellungen im Spiel) · `60` Dev-Konsole.

### 3.6 Bewegung

`--t-fast 90 ms` (Hover, Farbwechsel) · `--t-med 160 ms` (Aufklappen, Alerts einschieben) · `--t-slow 260 ms` (Menüwechsel) · `--pulse 1 s` (kritische Zustände). Nur `opacity` und `transform` werden animiert. `prefers-reduced-motion` (bzw. Einstellung „Bewegung reduzieren") setzt alle Dauern auf 0; Pulsieren wird zu statischem Doppelrahmen.

### 3.7 Zustände

| Zustand | Klasse | Darstellung | Beispiel |
|---|---|---|---|
| Standard | – | Fläche `--surface-2`, Rahmen `--line` | Zelle, Befehlsknopf |
| Hover | `:hover` / `.is-hover` | Rahmen Kupfer 500, Fläche `--surface-hover`, Taste färbt sich Kupfer | |
| Gedrückt | `:active` / `.is-pressed` | Fläche `--surface-press`, Rahmen Glut 600 | |
| Aktiv / scharf | `.is-active`, `.is-armed` | Rahmen Glut 500, Fläche `--surface-select`, 2-px-Glutkante oben | Platzieren, Befehl wartet auf Ziel |
| Ausgewählt | `.is-selected` | Tab/Segment: Glut-Unterstrich + Glut-Text | Tech-Tab, Einstellungs-Tab |
| An (Toggle) | `.is-on` | Glut-Raute oben links, Symbol Glut 300 | Auto-Abstich, Wiederholen |
| Gemischt | `.is-mixed` | hohle Glut-Raute | Toggle bei gemischter Auswahl |
| Fokus (Tastatur) | `:focus-visible` / `.is-focus` | Keramik-weißer Rahmen (nicht Glut, damit Fokus ≠ Auswahl) | Menü, Raster per Tab |
| Deaktiviert | `.is-disabled` | Fläche `--iron-900`, Symbol 28 % grau, Text `--text-off`, Tooltip nennt den Grund | Reclaim bei Panzerauswahl |
| Gesperrt | `.is-locked` | wie deaktiviert + Schloss, Tooltip nennt Voraussetzung | „ab T2 (Freisprechen)" |
| Leer | `.is-empty` | gestrichelter Rahmen, nur Tastenbeschriftung | freie Rasterzelle |
| Warnung | `.is-warn` / `--warn` | Orange + Dreieck | HP < 55 %, Überlauf |
| Kritisch | `.is-crit` / `--crit` | Rot + Achteck + Schraffur, 1-Hz-Puls (abschaltbar) | Stall, HP < 30 %, Vogt unter Feuer |
| Veraltet | `.is-stale` | 60 % Deckkraft | Alert älter als 20 s |
| Countdown | `.is-countdown` | Rot, Sekunden statt Taste | Selbstzerstörung |

Flow-Einheiten gibt es auch im HUD: Fortschritt und laufender Bau sind immer Glut (wie Baustrahl und Glutkern im Feld, faction.md §3.5).

---

## 4. Layout

### 4.1 Skalierung

`html { font-size: 16px × --ui-scale }`, alle HUD-Maße in rem.

- **Auto (Standard):** `scale = round₀,₀₅((Fensterhöhe / 1080)^0,78)`, begrenzt auf 0,8–1,5. Ergibt **1,0 bei 1080p**, **1,25 bei 1440p**, 1,5 bei 2160p. Der Exponent < 1 lässt auf großen Schirmen mehr Welt frei, statt das HUD linear aufzublasen.
- **Manuell:** 0,8 / 0,9 / 1,0 / 1,1 / 1,25 / 1,5 (Einstellungen → Barrierefreiheit). „Kompakt" = 1,0 auf 1440p.
- Die Welt (WebGL) skaliert unabhängig über Render-Skalierung (P9).
- Unter 1280 × 720 oder bei `scale · 1080 > Fensterhöhe` greift automatisch 0,8.

### 4.2 1080p (Skalierung 1,0)

```
0                                                                                         1920
┌──────────────────────┬──────────────────────┐          ┌─────────┐       ┌──────────────────────┐ 8
│ ◆ 312 /1.230   −3,5  │ ▲ 2.840 /4.900 +44,0 │          │ PAUSE   │       │⏱11:42 »×1,0 ⊞64/500 ≡│ 48
│ ▬▬▬▬       Flow 100% │ ▬▬▬▬▬▬▬▬  Flow 100 % │          └─────────┘       └──────────────────────┘
└──────────────────────┴──────────────────────┘ 68                          ┌ Alert (296 px)     ⌖ ┐ 56
 [Flow-Details, aufklappbar, 628 px breit]                                  ├ Alert             ⌖ ┤
                                                                            └ …                   ┘
                                   W E L T  (≈ 79 % der Höhe frei)
                                                                                      ┌ Tooltip 320 px ┐
                                                                                      └────────────────┘
[□ △ ⬡ ⊕  ◷2]           [1 ×18][2 ×3][3][4][5]…[0]          Befehle Alt+ [Q W E R T][A S D F G][Y X C B]  812
┌─ KARTE ──────┐┌─ AUSWAHL ─────────────────────────────────────────────┐┌─ BAU · VOGT   T1 T2 T3 ┐ 852
│              ││ Porträt │ Name, HP, Vet, Abstich, Werte │ Befehlskette ││ Q  W  E  R  T          │
│   216 × 216  ││ 104 px  │ ≤ 480 px                      │ Rest         ││ A  S  D  F  G   58-px- │
│              ││                                                        ││ Y  X  C  V  B   Raster │
└──────────────┘└────────────────────────────────────────────────────────┘└────────────────────────┘ 1072
8           224 228                                                  1592 1596                  1912
```

- Ressourcenleiste: 2 × 312 px, links oben. Status: rechts oben, 40 px hoch. Pause-/Tempo-Banner: oben Mitte, nur sichtbar, wenn Pause oder Tempo ≠ 1.
- Dock: 220 px + 8 px Rand = 21 % der Höhe. Die Leiste darüber (40 px) ist bis auf ihre Knöpfe durchklickbar.
- Alerts: rechts oben unter dem Status, höchstens 3 sichtbar + Zähler.
- Tooltip: über der Command Card, rechtsbündig; bei Welt-Hover neben dem Cursor.

### 4.3 1440p

- **Standard (1,25):** dieselbe Anordnung, alle Maße × 1,25 (Dock 275 px = 19 % der Höhe). Die Layoutbreite beträgt 2560 / 1,25 = 2048 CSS-px statt 1920; der Gewinn geht in die Mittelspalte des Docks, wo die Mehrfachauswahl mehr Einzeleinheiten pro Zeile zeigt.
- **Kompakt (1,0):** HUD in 1080p-Größe, Dock = 16 % der Höhe, +33 % Weltfläche. Für Spieler mit guter Sehschärfe und großen Armeen.
- Screenshots: `hud-1440-vogt.png`, `hud-1440-fabrik.png` (1,25), `hud-1440-kompakt.png` (1,0).

### 4.4 Regeln

- Das HUD-Wurzelelement hat `pointer-events: none`, nur Panels `auto`. Klicks in freie Welt landen immer beim Picking (C3).
- Kein Panel ändert seine Größe durch Inhalt. Wachsende Inhalte (Alerts, Queue, Einzeleinheiten) haben feste Slots und einen Zähler „+N".
- Die Mittelspalte des Docks ist die einzige flexible Breite (`minmax(0, 1fr)`).

---

## 5. Komponenten

Namen = spätere Preact-Komponenten (in den Mockups als `data-component`). „Binding" nennt die Aktualisierungsrate (§9).

### 5.1 Ressourcenleiste (`ResourceBar` → 2 × `ResourceMeter`, `FlowDetails`)

**Zweck:** Speicher, Einkommen, Verbrauch, Netto und Flow-Zustand je Ressource auf einen Blick (C10, E1–E4).

**Anatomie je Meter (312 × 60 px):** Glyphe (Raute/Flamme, 26 px) · Speicher groß `312` + klein `/ 1.230` · Netto rechts groß, grün/rot/grau · Speicherbalken · Flow-Zeile: `+28,0` Einkommen (grün), `−31,5` Verbrauch (rosé), rechts `Flow 100 %`.

- **Flow-Anzeige:** `Flow` = tatsächlich bedienter Anteil des angeforderten Verbrauchs (E2/E3). 100 % = kein Engpass. Bei anteiliger Drosselung zeigt sie den Faktor, mit dem alle Verbraucher laufen.
- **Stall (E3):** Rahmen `--crit`, pulsierender Rot-Verlauf von links, Speicherbalken rot, Netto zeigt den **Fehlbetrag** (Einkommen − Bedarf, z. B. `−85,0`), Flow-Zeile wird zum Badge `⛔ Stall · Flow 72 %`. Energy-Stall zusätzlich hörbar (Flow-Grundton kippt, faction.md §8.2) und als Alert.
- **Stall droht:** Netto negativ und Speicher leer in < 10 s → Netto-Zahl pulsiert gelb, Tooltip „leer in 7 s".
- **Überlauf (E4):** Speicher voll und Netto > 0 → Rahmen `--warn`, Badge `Voll · verfällt`.
- **Klick** öffnet/schließt **Flow-Details** (628 px, unter der Leiste): je Ressource die größten Verbraucher (Fabriken, Engineers, Upgrades, Unterhalt) mit „erhält / Bedarf" und Pause-Knopf (E13, MS10), darunter die Stall-Priorität. Ohne E13 (vor MS10) nur lesend.
- **Tooltip** am Meter: Einkommen nach Quelle (Mex, Kessel, Reclaim, Vogt), Speicher nach Gebäude, „leer/voll in N s".
- **Binding:** 10 Hz (jeder Sim-Tick), Flow-Details 4 Hz nur wenn offen.
- **IDs:** C10, E1, E2, E3, E4 (MS4); E13 (MS10); E7/E8 Reclaim-Anteil im Tooltip (MS5/MS8).

### 5.2 Status (`MatchStatus`)

Timer (Sim-Zeit, `mm:ss`, ab 60 min `h:mm:ss`) · Sim-Tempo `×1,0` (A6, Glut wenn ≠ 1, Tasten `−`/`+`) · Einheiten `64 / 500` (U7, gelb ab 90 %, rot bei Cap) · Punkte beider Häuser (optional, **A19 Post-MVP**, im MVP ausgeblendet oder nur im Replay) · Menüknopf (Esc).
Binding: Timer 1 Hz, Cap bei Änderung, Punkte 1 Hz. IDs: A5 (MS1), U7 (MS8), A6 (MS11), A19 (Post-MVP).

### 5.3 Pause- und Tempo-Banner (`PauseBanner`)

Oben Mitte, 272 px. **Pause:** `PAUSE`, darunter „Sim angehalten · Kamera und Befehle bleiben aktiv · P fortsetzen" (A5). **Hintergrund-Tab (S9):** „Pausiert – Tab war verborgen". **Tempo ≠ 1:** schmales Banner `SIM-TEMPO ×2,0`. **Sim-Lag** (Scheduler kommt nicht nach oder KI antwortet `pending`): kleines Banner „Sim hinkt nach · ×0,8 effektiv". Ereignisgetrieben. IDs: A5 (MS1), S9 (MS9), A6 (MS11).

### 5.4 Minimap (`Minimap`)

216 × 216 px, Kopf mit drei Schaltern: Gelände/Taktisch, Ressourcenpunkte, „Ganze Karte" (springt in den maximalen Strategic Zoom, C2).
- **Inhalt:** Terrain (einmal gerendert, gecacht), Fog in drei Stufen (nie gesehen dunkel, erkundet gedimmt, sichtbar klar; I1), Ressourcenpunkte als Rauten, eigene Einheiten 4 px und Gebäude 6 px in Teamfarbe mit dunklem Rand, Feinde sichtbar gefüllt, Ghost-Gebäude hohl (I2), Radar-Blips als graue Ringe (I3), Alert-Pings als Glutringe (P8), Kamera als Trapez (Perspektive).
- **Interaktion:** Linksklick/-ziehen = Kamera setzen; Rechtsklick = Befehl wie in der Welt (Move/Attack/…, C4); Shift = anhängen; Mausrad über der Minimap zoomt die Welt nicht.
- **Binding:** Canvas2D. Einheiten/Blips/Pings 4 Hz, Fog 2 Hz, Terrain einmal; der Kamerarahmen liegt auf einer eigenen kleinen Overlay-Canvas und wird nur bei Kamerabewegung neu gezeichnet (4 Linien). Kein `getImageData`. Budget ≤ 0,5 ms Main-JS (MS11-Abnahme).
- **IDs:** C16 (MS11). Bis MS11 ersetzt der Strategic Zoom (C2, MS3) die Übersicht; der Platz im Dock zeigt dann die Karten-Kennzahlen (Name, Größe, Mex frei/belegt). Siehe Entscheidung UI-E2.

### 5.5 Auswahl-Panel (`SelectionPanel`)

Kopf: „Auswahl · N Einheiten · M Typen", rechts Gruppe/Haus. Vier Ausprägungen:

**Einzeln (`UnitDetail`)** – Porträt 104 px (großes Strategic Icon, Tech-Kürzel, Vet-Rauten) · Name (Rufname) + Funktionsrolle (faction.md §7.1 Regel 4) · Balken HP (Zahlen rechts), Schild (K10), Vet-Fortschritt (U9: Mass-Wert der Kills bis zur nächsten Stufe), beim Vogt **Abstich** (Energy-Vorrat gegen 7.500-E-Schwelle, U8) · Wertezeile DPS, Reichweite, Tempo, Sicht, BP, Regeneration · rechts **Befehlskette** (`OrderQueue`): laufender Befehl mit Glutkante und Fortschritt, gehängte Befehle nummeriert (C5), Klick springt zum Wegpunkt, Rechtsklick entfernt (C19 Post-MVP: Ziehen).

**Mehrfach** – oben **Typ-Kacheln** (`SelectionGroups`, 68 × 76 px): Icon, `×9`, HP-Durchschnitt als Balken, Anzahl beschädigter (`2 < 50 %`), höchste Vet. Klick = nur dieser Typ, Shift+Klick = Typ abwählen, Strg+Klick = nur beschädigte dieses Typs, Tab = Fokus-Typ wechseln (bestimmt Tooltip und Command-Card-Fokus). Darunter **Einzeleinheiten** (`SelectionUnits`, bis 60 Stück, 34 × 38 px, HP-Strich; darüber nur Kacheln + „+N"). Fußzeile: Σ DPS, Σ Mass, Ø HP, Tempo der langsamsten Einheit.

**Fabrik (`FactoryDetail` + `FactoryQueue`, §5.7)** – Porträt, HP, **Build Power eigen + Assist** (`20 + 15 = 35`, B2), Helferliste, Nachbarschaftsbonus (E11), Rally-Status.

**Leer** – Kurzhilfe: Klick/Rahmen, H = Vogt, `.` = untätiger Engineer, Strg+A = alle.

Binding: Struktur bei Auswahländerung (Ereignis); HP/Vet/Kette 4 Hz; Bau- und Queue-Fortschritt 10 Hz (nur `transform`). IDs: C3 (MS3, Zahl und Ringe), **C9 (MS6)**, B2/B3 (MS6), U9 (MS11), K10 (MS13), U8 (MS6).

### 5.6 Command Card (`CommandCard` → `TechTabs`, 15 × `CardCell`)

**Raster:** 5 × 3 Zellen à 58 px = **QWERT / ASDFG / ZXCVB** nach physischer Position (`KeyboardEvent.code`). Die Beschriftung folgt dem Tastaturlayout (DE: untere Reihe `Y X C V B`); siehe §7.2.

**Seiten nach Auswahl:**

| Auswahl | Kopf | Inhalt | Tabs |
|---|---|---|---|
| Vogt / Engineers | „Bau · Vogt" | Bau-Menü nach `roster.json` → `hotbuildGrid.Bau`: Q Zapfstelle · W Glutkessel · E Dampfquelle · R Erzspeicher · T Glutspeicher · A Landwerk · S Luftwerk · D Horcher · F Schirm · Y Riegel · X Rost/Hochrost · C Mauer · V Tiegel/Hochofen | T1 · T2 · T3 (höchste baubare Stufe vorgewählt) |
| Landwerk | „Produktion · Landwerk I" | Q Panzer · W Artillerie · E Engineer · R Flugabwehr · A Späher · S Bots · D Schürze · F Reißnadel · **B Freisprechen** (Upgrade, U5) | T1 · T2 · T3 |
| Luftwerk | „Produktion · Luftwerk I" | Q Abfangjäger · W Bomber · E Gunship · R Jagdbomber · A Aufklärer · B Freisprechen | T1 · T2 |
| Mex, Radar, Schild (Upgrade-fähig) | „Gebäude · Zapfstelle I" | B Upgrade (B4/B8), G Fähigkeit (C17), D Pause (E13), Selbstzerstörung | – |
| nur Kampfeinheiten | „Befehle · N Einheiten" | **Befehlsraster** (§5.8); die Befehlsleiste darüber entfällt | – |
| gemischt mit Bauern | Bau-Seite der höchsten Bauklasse | Schnittmenge der Baulisten (C8), Befehle über Alt | T1–T3 |

**Zelle:** Taste oben links · Strategic Icon · Kurzname unten (ohne römische Stufe) · rechts oben entweder Tech-Striche (welche Stufen die Rolle hat, aktuelle hell) oder Queue-Badge · unten Fortschrittsstrich (laufende Produktion). Zustände §3.7; gesperrte Zellen nennen im Tooltip die Voraussetzung („ab T2: Landwerk freisprechen"), deaktivierte den Grund („Unit-Cap erreicht").

**Hotbuild-Zyklus:** Gleiche Taste = gleiche Rolle; erneutes Drücken wechselt nur die Tech-Stufe (höchste baubare zuerst), nie den Typ (`hotbuildGrid.rule`). Der Tech-Tab folgt mit.

**Im Flow-System gibt es kein „zu teuer":** Zellen werden bei knapper Eco nicht deaktiviert; der Tooltip zeigt stattdessen den Flow-Bedarf (Mass/s, Energy/s bei aktueller BP) und färbt ihn gelb, wenn er das Netto übersteigt.

Binding: Ereignis (Auswahl, Tab, Tech-Freischaltung, Cap), Badges bei Queue-Änderung, Fortschritt 10 Hz. IDs: **C8 (MS4)** mit Raster ohne Rebinding, B1 (MS4), U5/B4 (MS8), U10 (MS13), C17 (MS10), C20 Rebinding Post-MVP.

### 5.7 Fabrik-Queue (`FactoryQueue`)

Rechter Teil des Auswahl-Panels bei Fabrikauswahl (B3):
- **Jetzt:** Icon, Name, Restzeit, Fortschrittsbalken, Prozent groß.
- **Liste:** zusammengefasste Blöcke gleicher Einheiten (`Punze ×5`, `Kelle ×2`…), bis 10 Blöcke sichtbar; Loop-Markierung ↻ bei Wiederholen.
- **Steuerung:** Wiederholen (Toggle, Loop), Pause (E13), Rally (setzt den Modus; eigentlich Rechtsklick auf Boden bei Fabrikauswahl), Leeren.
- **Klicks (an Command-Card-Zellen und Queue-Blöcken):** Klick +1 · **Shift+Klick +5** · Rechtsklick −1 · Shift+Rechtsklick −5 · Strg+Klick = an den Anfang setzen. Tasten wie Klick (Q = +1 Panzer, Shift+Q = +5).
- **Mehrfach-Fabrik-Auswahl:** Aufträge werden reihum verteilt; die Liste zeigt die Summe, Kopf „3 Fabriken".
- **Rally:** grüne gestrichelte Linie mit Fahne in der Welt; Shift+Rechtsklick hängt Wegpunkte an; Rally auf eine Einheit = Assist/Guard.
Binding: Ereignis + Fortschritt 10 Hz. IDs: **B3 (MS6)**, B2 (MS6), E13 (MS10).

### 5.8 Befehlsleiste (`OrderBar` → `OrderButton`)

Über der Command Card, rechtsbündig, drei Gruppen in Rasterreihenfolge. Sichtbar, wenn die Command Card mit Bauen/Produktion belegt ist; die Tasten sind dann **Alt + Rastertaste**. Bei reinen Kampfauswahlen stehen dieselben Befehle ohne Alt direkt im Raster.

| Taste | Befehl | Symbol | Verhalten | ID · MS |
|---|---|---|---|---|
| Q | Bewegen | Pfeil | scharf → Linksklick Ziel | C4 · MS6 |
| W | Patrouille | Kreisel | Wegpunkte mit Shift; Engineers reclaimen/reparieren/assistieren automatisch | C12 · MS11 |
| E | Assist / Bewachen | Doppel-Chevron | Ziel eigene Einheit/Baustelle/Fabrik | B2 · MS6 |
| R | Reclaim | Trichter | Ziel Wrack/Prop/eigenes Gebäude | E7 · MS5, E12 · MS10 |
| T | Reparieren | Schlüssel | | G4 · MS6 |
| A | Angriff / Angriffsbewegung | Fadenkreuz + Pfeil | auf Einheit = Angriff, auf Boden = Attack-Move | C6 · MS8 |
| S | Stop | Achteck | leert die Befehlskette | S3 · MS1 |
| D | Pausieren | ‖ | Bau/Produktion/Upgrade anhalten | E13 · MS10 |
| F | Feuermodus | Fadenkreuz, 3 Punkte | Zyklus Feuer frei → Nur erwidern → Feuer halten (→ Stellung halten) | K6 · MS7 |
| G | Fähigkeit | je Einheit | Schild, Radar, Auto-Abstich an/aus; gemischt = hohle Raute | C17 · MS10 |
| Y (KeyZ) | Boden angreifen | Fadenkreuz über Boden | nur Artillerie; Badge = Anzahl fähiger Einheiten | K6 · MS7 |
| X | Abstich | Blitz | manuell, scharf → Ziel; grau unter 7.500 E | U8 · MS6 |
| C | Formation | drei Punkte | Formation wählen; Rechtsklick-Ziehen zieht Linie | C13 · MS13 |
| B | Selbstzerstörung | Stern, rot | **Strg+Entf**: 5-s-Countdown auf Knopf und Einheit, erneut = Abbruch | C18 · MS11 |

Zustände: scharf (wartet auf Ziel, Cursor wechselt, Esc/Rechtsklick bricht ab), Toggle an/gemischt, Zyklus mit Punkten, deaktiviert mit Grund. Binding: Ereignis + Toggle-Zustände 4 Hz. IDs siehe Tabelle; Grundlage C4/C5/S3.

### 5.9 Selection-Filter und Idle-Engineer (`SelectionFilter`, `IdleButton`)

Über der Minimap: vier Filter (34 px) – **Alle Land (F2)**, **Alle Luft (F3)**, **Alle Fabriken (F4)**, **Alle Engineers (F6)** – und rechts der **Idle-Engineer**-Knopf mit Zähl-Badge (Glut, nur wenn > 0).
- Ohne Shift wählen Filter aus allen eigenen Einheiten; **mit Shift filtern sie die aktuelle Auswahl**.
- **`.`** wählt den nächsten untätigen Engineer und zentriert die Kamera (wiederholt = nächster), **Shift+.** alle untätigen, **`,`** nächste untätige Fabrik.
- Untätig = keine Order seit ≥ 2 s und kein Assist. Der Vogt zählt nicht.
Binding: Zähler 1 Hz. IDs: **C14 (MS6)**.

### 5.10 Control Groups (`ControlGroups`)

Zehn Plätze (1–0), je 52 × 34 px: Taste, Icon des häufigsten Typs, Anzahl. Aktive Gruppe mit Glutrahmen. Abrufen = Zahl, zweimal schnell = Kamera zentrieren, **Speichern = Alt+Zahl**, Hinzufügen = Shift+Alt+Zahl, Auswahl ergänzen = Shift+Zahl. Strg+Zahl nur bei aktiver Tastatursperre im Vollbild (Browser reserviert Strg+1…9). Binding: Ereignis, Zahlen 1 Hz. ID: C7 (MS3).

### 5.11 Alerts (`AlertFeed` → `Alert`)

Rechts oben, 296 px, neueste oben, höchstens 3 sichtbar, darunter „N ältere · Shift+␣ durchblättern". Jeder Alert: Stufensymbol · Titel · Metazeile (Ort, Alter) · Knopf **Zum Ort**. Der neueste trägt die Taste **Leertaste**. Gleichzeitig: Glutring-Ping auf der Minimap, Gong + Sprachzeile (audio.md, Hüttenstimme).

| Alert (SOUNDLIST) | Stufe | Symbol | Wiederholintervall | Sprung zu | MS |
|---|---|---|---|---|---|
| Vogt unter Feuer (`alt_commander_danger`) | kritisch | Achteck | 8 s | Vogt | MS9 |
| Energie knapp (`alt_energy_stall`) | kritisch | Achteck | 20 s | öffnet Flow-Details | MS9 |
| Masse knapp (`alt_mass_stall`) | Warnung | Dreieck | 20 s | öffnet Flow-Details | MS9 |
| Basis angegriffen (`alt_base_attacked`) | Warnung | Dreieck | 15 s | Gebäude | MS9 |
| Einheit angegriffen (`alt_unit_attacked`) | Warnung | Dreieck | 10 s | Einheit | MS9 |
| Feindliche Luft (`alt_enemy_air`) | Warnung | Dreieck | 30 s | Sichtung | MS14 |
| Feind-Vogt gesichtet (`alt_enemy_commander_spotted`) | Info | Kreis | 30 s | Sichtung | MS9 |
| Speicher voll (`alt_storage_full`) | Info | Kreis | 30 s | – | MS14 |
| Bau fertig (`alt_build_complete`) | Erfolg | Kreis mit Haken | 5 s | Gebäude | MS9 |
| Werk freigesprochen (`alt_factory_upgraded`) | Erfolg | Kreis mit Haken | 5 s | Werk | MS9 |

Regeln: Alerts kommen nur aus dem Event-Stream (PLAN §3.1 „Präsentation"), nie aus Client-Logik. Gleichartige Alerts innerhalb des Intervalls werden zusammengefasst („Einheit angegriffen ×3"). Kritische blitzen zweimal auf (abschaltbar), ab 20 s werden alle gedimmt, nach 60 s entfernt. `aria-live="polite"` (kritisch: `assertive`). Abnahme MS9: Alert ≤ 1 s nach Ereignis. IDs: **P8 (MS9)**, P7 (MS5).

### 5.12 Tooltip (`TooltipLayer` → `UnitTooltip` / `OrderTooltip` / `ResourceTooltip`)

320 px, Kupferrahmen, erscheint nach 350 ms (Tastaturfokus sofort), verschwindet sofort.
- **Kopf:** Icon, Rufname, Funktionsrolle, Ziel-Layer (Land/Luft), Taste.
- **Kosten:** Mass, Energy, darunter der **Flow-Bedarf** bei aktueller Build Power (`≈ 6,5 M/s · 33 E/s`).
- **Werte-Raster (3 × 2):** HP · DPS (bzw. Mass/s, Energy/s, Speicher) · Reichweite (bzw. Build Power) · Tempo (bzw. Unterhalt, Sicht) · Bauzeit bei BP · Tech.
- **Beschreibung:** 2 Sätze (`descKey`, faction.md §2.3).
- **Nachbarschaft (E11):** Grünspan-Kasten mit den Adjacency-Effekten aus `roster.json`.
- **Fuß:** Bedienhinweise (Klick platzieren/+1, Shift mehrere/+5, Rechtsklick −1).
- Beim Hover über einer Bauzelle zeigt die Welt die Reichweite als Ring (C15) und beim Platzieren die Nachbarschaft am Ghost.
Werte stammen aus `view.json`; DPS = Summe der Waffen ohne Abstich. IDs: **C9 (MS6)**, E11 (MS10), C15 (MS8).

### 5.13 Dev-Konsole (`DevConsole` + `BudgetOverlay`)

Oben, 42 % Höhe, Mono. Kopf mit Build, simId, Tick; Log mit Eingabe (›), Erfolg (grün), Fehler (rot); Eingabezeile mit Autovervollständigung (Tab) und Verlauf (↑). Rechts oben das Tick-Budget pro Phase (p95) mit Summe gegen 10 ms. Öffnen/Schließen mit `^` / `` ` `` / F1 (bestehend). Alle Konsolenbefehle laufen als Commands durch die Sim und landen im Replay (S3). Binding: Ereignis, Budget 2 Hz. IDs: **S8 (MS1)**.

### 5.14 Welt-Overlays (nicht DOM)

Auswahlringe, HP-/Baubalken über Einheiten, Wegpunktlinien der Befehlskette, Bau-Ghosts, Range-Ringe, Placement-Footprint, Rally-Linien und der Baustrahl gehören dem Renderer (PLAN §3.7: Decals im Terrain-Shader, IconPass). Das Designsystem legt nur ihre Farben fest:

| Overlay | Farbe / Form |
|---|---|
| Auswahlring | Weiß 2 px, dunkler Außenrand |
| HP-Balken | ok/warn/crit wie §3.1, nur bei Auswahl oder < 100 % |
| Wegpunkte (C5) | Glutkern `#ffd9a0`, gestrichelt, Punkte an Knoten |
| Bau-Ghost (C5) | Ghost-Icon (faction.md §6.5), Footprint grün/rot schraffiert |
| Nachbarschaft am Ghost (E11) | Grünspan-Etikett „+25 % Produktion (Glutspeicher)" |
| Range-Ring (C15) | Waffen lachsrot gestrichelt, Radar Blau, Schild Cyan, Bauradius Glutkern fein gepunktet |
| Rally (B3) | Grün gestrichelt + Fahne |
| Angriffsziel | Rot, Fadenkreuz |
| Auswahlrahmen | Weiß 1 px, 6 % Füllung (DOM, z 10) |

### 5.15 Menüs

**Hauptmenü (`MainMenu`, A3 · MS9):** Wortmarke „Flow & Fire", Tagline, vertikale Navigation (Gefecht · Replays [MS11] · Einstellungen · Einweisung [Post-MVP, gesperrt] · Mitwirkende), Emblem (Lot im Gussring), Karte „Letzte Partie" mit Replay/Revanche, Fuß mit Build, simId, Transport und Preset, Sprache DE/EN oben rechts. Tastatur: ↑/↓, Enter; Fokus startet auf „Gefecht".

**Gefecht einrichten (`SkirmishSetup`, A3 · MS9):** drei Spalten – Kartenliste mit Mini-Vorschau (Setons, Hollow Ridge, drittes 1v1-Layout M8), Kartenbeschreibung und KI-Profil · große Kartenvorschau mit Ressourcenpunkten und nummerierten Startpositionen (Klick tauscht Start) · Häuser (Slot, Name, Fraktion Varkan, Farbe, Team; KI-Slot mit **Stufe Leicht/Normal/Schwer** (A10, MS14) und **AIx-Schalter + Regler ×1,0–×2,0** (A11, MS14)) und Regeln (Siegbedingung Assassination/Supremacy/Annihilation (A4, A12 MS14), Unit-Cap (U7), Anfangstempo (A6), Nebel, Teamfarben-Modus). Fuß: Prüfstatus (Karte/Blueprints, simId), Zurück, **Gefecht starten** (Glut, Enter). Weitere Slots erst mit A17.

**Einstellungen (`Settings`):** vertikale Tabs Grafik · Audio · Tasten · Barrierefreiheit · Spiel & Sprache; Zeilen mit Label + Erklärung links, Steuerelement rechts, geänderte Werte mit Glutpunkt; rechts eine Kontextkarte (Lastschätzung, Klangprobe, Rasterbelegung, Farbenblind-Vorschau). Grafik: Autodetect-Kasten (GPU + 3-s-Benchmark, P9), Preset Niedrig/Mittel/Hoch/Ultra, Render-Skalierung, Schatten-Kaskaden, Splat-Layer, Partikel-Cap, Bloom, Kantenglättung, Bildrate, Kamera-Wackeln. Audio: Busse Gesamt/Effekte/Ansagen/Oberfläche/Musik/Umgebung, Warn-Ansagen (Sprache/Nur Gong/Aus), hörbarer Stall, Ton im Hintergrund. Tasten: **Tastenschema Raster/WASD** (UI-E1), Tastatur-Ansicht mit Raster-, Kamera- und Systemtasten in DE-Beschriftung, Tabelle der Sonderkombinationen; Umbelegen folgt mit C20. Barrierefreiheit: §8. Spiel: Sprache, Randschwenk, Tooltips, Pause im Hintergrund (S9), Replays automatisch speichern (N1). IDs: P9 (MS14; Preset-Infrastruktur MS2), C11 (MS2), P12 (MS4), P16 (Post-MVP, Teile vorgezogen).

**Ladebildschirm (`LoadingScreen`, P3 · MS2):** Kartenname groß, Beschreibung, Regeln, beide Häuser mit Bereitschafts-Badge, Kartenvorschau mit Starts; unten fünf Phasen (Manifest · Assets · Karte → Sim · Sim-Worker · KI-Worker) mit eigenem Balken, aktuelle Datei mit Quelle (Cache/Netz), Bytes, Gesamtbalken, Hinweiszeile. Fehler: Badge + Ursache + „Erneut"/„Ins Menü". Baut auf der bestehenden `apps/game/src/ui/LoadingScreen.tsx` auf (gleiche Daten).

**Auswertung (`ScoreScreen`, A13 · MS14):** Urteil groß („Sieg" / „Lot gebrochen" mit Lore-Zeile, faction.md §2.2), Meta (Spielzeit, Punkte, Effizienz, Replay-Größe), Tabs Übersicht/Wirtschaft/Armee/Einheiten. Übersicht: Kennzahltabelle beider Häuser (besserer Wert in Glut) und beste Einheiten; rechts Ereignisleiste und zwei Verlaufsgraphen (Mass-Einkommen, Armeewert) mit **einer** Achse, Teamfarben, zweite Serie gestrichelt, Direktbeschriftung am Ende, Legende, Fadenkreuz-Tooltip. Fuß: Replay speichern/ansehen (N1), Revanche, Hauptmenü. Werte 1:1 aus Sim-Stats (MS14-Abnahme). Minimalform ab MS5/MS9: nur Urteil + Spielzeit + Knöpfe (A4).

**Esc-Menü im Spiel (`GameMenu`, G12 · MS9, nicht gemockt):** Modal mittig: Fortsetzen · Einstellungen · Tastenübersicht · Aufgeben (Bestätigung) · Ins Hauptmenü. Im Einzelspieler pausiert es die Sim.

---

## 6. Komponentenliste mit Zuständen

| Komponente | Zustände | Mockup |
|---|---|---|
| `Button` (primär, sekundär, ghost, gefahr; sm/md/lg/icon) | Standard, Hover, Gedrückt, Fokus, Deaktiviert | components |
| `CardCell` | Standard, Hover, Gedrückt, Aktiv (Platzieren), Fokus, Queue-Badge, Fortschritt, Tech-Striche, Gesperrt, Deaktiviert, Leer | components, hud |
| `OrderButton` | Standard, Hover, Scharf, An, Gemischt, Zyklus, Deaktiviert, Fokus, Gefahr, Countdown | components, hud |
| `Tab`, `Segmented`, `Switch`, `Check`, `Range`, `Select`, `Input` | Standard, Hover, Ausgewählt/An, Fokus, Deaktiviert | components, settings |
| `Bar` (HP, Schild, Bau, Mass, Energy) | Wert, Warnung, Kritisch (schraffiert) | components |
| `Badge`, `Key`, `Vet` | neutral, ok, info, warn, crit, ember | components |
| `ResourceMeter` | Normal, Überlauf, Stall droht, Stall | components, hud |
| `FlowDetails` | geschlossen, offen, Zeile pausiert, Engpass | hud |
| `MatchStatus` | normal, Tempo ≠ 1, Cap nah/erreicht | hud |
| `PauseBanner` | Pause, Hintergrund-Pause, Tempo, Sim-Lag | hud |
| `Minimap` | Gelände/Taktisch, Ressourcen an/aus, Ping, Fog-Stufen | hud |
| `SelectionPanel` | leer, einzeln, mehrfach (Kacheln + Einzeleinheiten), Fabrik, Kachel-Fokus | hud |
| `OrderQueue` | laufend, gehängt, leer | hud |
| `CommandCard` | Bau, Produktion, Gebäude, Befehle, leer; Tabs T1–T3 | hud |
| `FactoryQueue` | laufend, Wiederholen an, pausiert, leer, Mehrfach-Fabrik | hud |
| `OrderBar` | sichtbar (Alt-Tasten), ausgeblendet (Befehle im Raster) | hud |
| `SelectionFilter`, `IdleButton` | Standard, Hover, Idle-Zähler 0/N | hud |
| `ControlGroups` | leer, belegt, aktiv | hud |
| `Alert` | kritisch (neu blitzt), Warnung, Info, Erfolg, veraltet, zusammengefasst | components, hud |
| `Tooltip` | Einheit/Gebäude, Befehl, Ressource; mit/ohne Nachbarschaft | components, hud |
| `DevConsole`, `BudgetOverlay` | offen, Autovervollständigung, Fehlerzeile | hud |
| `Cursor` (17 Formen) | §7.1 | components |
| Menü-Seiten | §5.15 | menu, skirmish, settings, loading, score |

---

## 7. Interaktionsregeln

### 7.1 Cursor-FSM

Erweitert die bestehende `CursorFsm` (`packages/client/src/cursor-fsm.ts`: idle, boxSelect, grabPan, rotate, edgePan, confinedEdgePan). Neu sind die **Befehlsmodi**; die Zeigerzustände bleiben unverändert und haben Vorrang.

```
                    ┌──────────── Esc / Rechtsklick / Befehl ausgeführt (ohne Shift) ─────────────┐
                    ▼                                                                             │
 ┌──────┐ Bauzelle/Hotbuild ┌───────────┐ Linksklick+Ziehen ┌──────────────┐ loslassen          │
 │ idle │──────────────────▶│ placement │──────────────────▶│ placementDrag│───────────────▶ Befehl(e)
 │      │◀──────────────────│ (Ghost)   │◀── Shift gehalten: Modus bleibt nach Klick ──────────────┤
 │      │   Esc / RMB       └───────────┘                                                         │
 │      │ Befehlsknopf/Taste ┌───────────┐ Linksklick Ziel ─────────────────────────────────────▶ Befehl
 │      │───────────────────▶│ orderArmed│ (Shift: bleibt scharf)                                  │
 │      │                    └───────────┘                                                         │
 │      │ RMB halten+Ziehen ┌───────────────┐ loslassen (C13, MS13)                                 │
 │      │──────────────────▶│ formationDrag │─────────────────────────────────────────────────────▶ Befehl
 │      │ LMB auf Minimap   ┌───────────────┐                                                       │
 │      │──────────────────▶│ minimapDrag   │── loslassen ─▶ idle                                   │
 └──────┘  (+ bestehend: boxSelect, grabPan, rotate, edgePan, confinedEdgePan; cancel() bricht alles ab)
```

- **Hover-Auflösung in `idle`:** Über HUD → Standardzeiger; über eigener Einheit → heller Glutkern-Zeiger; sonst zeigt der Zeiger den **Kontextbefehl**, den ein Rechtsklick auslösen würde (§7.4).
- **Zeigerformen** (components.html): Standard, Über eigener Einheit, Bewegen, Angriff, Angriffsbewegung, Boden angreifen, Patrouille, Assist/Bewachen, Reclaim, Reparieren, Rally, Ungültig, Randschwenk (8 Richtungen), Greifen, Drehen, Platzieren, Warten (Sim-Lag). 32 px, Hotspot oben links (Pfeile) bzw. Mitte (Greifen/Drehen), als CSS-`cursor: url()` mit PNG@1×/2×; im Pointer-Lock zeichnet der Client den Zeiger selbst.
- `cancel()` (Blur, Pointercancel, Textfokus) verlässt auch Befehlsmodi.

### 7.2 Tastatur-Schichten (Entscheidung UI-E1)

Tasten werden über `KeyboardEvent.code` gebunden (bestehender Vertrag in `actions.ts`); die Beschriftung kommt aus `navigator.keyboard.getLayoutMap()` (Chromium) bzw. einer Tabelle nach `navigator.language` (Firefox/WebKit). Auf DE-Tastaturen trägt die physische `KeyZ` also „Y".

**Auflösungsreihenfolge (erste passende Schicht gewinnt):**

1. Textfeld mit Fokus (Konsole, Seed, Namen) – alles geht an das Feld, außer Konsolentaste und Esc.
2. Modal / Menü (Esc schließt).
3. Befehlsmodus aktiv (`placement`, `orderArmed`): Esc bricht ab, Shift hält den Modus.
4. **Alt + Rastertaste** → Befehlsraster (immer, unabhängig von der Auswahl).
5. **Rastertaste** (15 Tasten) → Seite der Command Card (Bau / Produktion / Befehle). Leere Zellen fallen durch.
6. Globale Tasten außerhalb des Rasters (Tabelle unten).
7. Kamera: Pfeiltasten immer; WASD nur bei leerer Auswahl oder im Schema „WASD".

**Schemata** (Einstellungen → Tasten, kein freies Umbelegen vor C20):
- **Raster (Standard, empfohlen):** wie oben. FAF-nah, Hotbuild und Befehle ohne Modifier.
- **WASD:** WASD schwenkt immer (Schicht 7 vor 5), das Raster braucht dann Alt, Befehle Alt+Shift.

Das bestehende `S = Stop` bleibt im Raster-Schema erhalten (Befehlsraster S), bei Bau-Auswahl ist S dagegen Luftwerk bzw. Bots; Stop dann über Alt+S. `WASD mit anyModifiers` aus MS2 entfällt im Standardschema. → Umstellung von `DEFAULT_ACTION_MAP` in MS4 zusammen mit C8.

**Globale Tasten:**

| Taste | Aktion | ID |
|---|---|---|
| Esc | Modus abbrechen → Auswahl leeren → Esc-Menü | – |
| P / Pause | Pause | A5 |
| `−` / `+` | Sim-Tempo | A6 |
| H | Zum Vogt | C1 |
| Pos1 | Kamera zurücksetzen | C1 |
| Leertaste / Shift+Leertaste | Zum neuesten Alert / ältere durchblättern | P8 |
| 1–0, Alt+Zahl, Shift+Alt+Zahl, Shift+Zahl | Gruppen abrufen / speichern / hinzufügen / ergänzen | C7 |
| Strg/⌘+A | alle eigenen Einheiten | C3 |
| `.` / Shift+`.` / `,` | untätiger Engineer / alle / untätige Fabrik | C14 |
| F2 / F3 / F4 / F6 (Shift = Auswahl filtern) | Land / Luft / Fabriken / Engineers | C14 |
| Tab | Fokus-Typ in Mehrfachauswahl | C9 |
| Strg+Entf | Selbstzerstörung (Countdown) | C18 |
| `^` / `` ` `` / F1 | Dev-Konsole | S8 |
| N | Einzelschritt (nur Dev/pausiert) | S8 |
| Alt+Enter | Vollbild | C11 |

**Browser-sicher:** keine Bindungen auf Strg+W/T/N/Tab/1–9/L/R/F5 (vom Browser reserviert oder riskant); Strg+Zahl nur bei `navigator.keyboard.lock()` im Vollbild; Kontextmenü unterdrückt (C11).

### 7.3 Modifikatoren

| Kontext | ohne | Shift | Strg/⌘ | Alt |
|---|---|---|---|---|
| Linksklick Einheit | nur diese | hinzufügen/entfernen | alle dieses Typs auf dem Schirm | – |
| Doppelklick Einheit | alle dieses Typs auf dem Schirm | hinzufügen | – | – |
| Auswahlrahmen | ersetzen | hinzufügen | entfernen | nur Kampfeinheiten (ohne Engineers) |
| Rechtsklick (Befehl) | ersetzt Befehlskette | **anhängen** (C5) | Angriffsbewegung | Befehl nur an Fokus-Typ |
| Befehl scharf + Klick | ausführen, Modus endet | ausführen, Modus bleibt | – | – |
| Platzieren + Klick | platzieren, Modus endet | platzieren, Modus bleibt, Queue anhängen | – | – |
| Command Card, Fabrik | +1 | +5 | an den Anfang | – |
| Command Card, Rechtsklick | −1 | −5 | – | – |
| Typ-Kachel | nur dieser Typ | Typ entfernen | nur beschädigte | – |
| Filter-Knopf | aus allen wählen | aktuelle Auswahl filtern | – | – |
| Rastertaste | Hotbuild/Produktion/Befehl | +5 (Fabrik) / Platzieren halten | – | Befehlsraster |

### 7.4 Kontext-Rechtsklick (C4)

Jede Einheit der Auswahl löst den Befehl für sich auf (Engineers reclaimen, Panzer fahren zum Punkt); der Zeiger zeigt den Befehl mit der höchsten Priorität in der Auswahl.

| Ziel unter dem Zeiger | Fähigkeit in Auswahl | Befehl | Zeiger |
|---|---|---|---|
| Boden (passierbar) | beweglich | Bewegen | Bewegen |
| Boden, Fabrik ausgewählt | Fabrik | Rally setzen | Rally |
| feindliche Einheit/Gebäude (sichtbar) | Waffe | Angriff | Angriff |
| Radar-Blip | Waffe | Angriff (ungenau, I3) | Angriff |
| Ghost-Gebäude (I2) | Waffe | Boden angreifen am letzten Ort | Boden angreifen |
| eigene unfertige Baustelle | Engineer | Assist (weiterbauen, B6) | Assist |
| eigenes geplantes Ghost (C5) | Engineer | übernehmen | Assist |
| eigene Fabrik | Engineer | Factory-Guard (B2) | Assist |
| eigene beschädigte Einheit/Gebäude | Engineer | Reparieren | Reparieren |
| eigene Einheit | Kampfeinheit | Bewachen (folgen) | Assist |
| Wrack, Baum, Fels | Engineer / Vogt | Reclaim (E7, E8) | Reclaim |
| Wrack | nur Kampfeinheiten | Bewegen | Bewegen |
| Mass-/Hydro-Spot | Engineer | Bewegen (kein Auto-Bau) | Bewegen |
| unpassierbar / Wasser (MVP) | Land | nächster erreichbarer Punkt | Bewegen, gedimmt |
| außerhalb der Karte | – | nichts | Ungültig |
| Minimap-Punkt | wie Welt | wie Welt, ohne Ziel-Einheiten | wie Welt |

Abnahme MS6: Kontext-Rechtsklick in der Testmatrix zu 100 % korrekt.

### 7.5 Platzieren und Drag-Build

- Hotbuild-Taste oder Zellklick → `placement`: Ghost am Zeiger, rastet im Footprint-Grid ein, grün/rot nach `rules.canPlace` (B1; Ghost-Verdikt = Sim-Verdikt, MS4-Abnahme). Mex-Ghosts schnappen im Umkreis von 4 WU auf freie Spots.
- Am Ghost: Nachbarschaftsetikett (E11), Reichweitenring (C15), Flow-Bedarf im Tooltip.
- **Ziehen (Drag-Build):** Linksklick halten und ziehen legt eine Reihe von Ghosts im Footprint-Abstand; ungültige Plätze sind rot und werden übersprungen. Im MVP für Mauern (PLAN §7 Entscheidung 3, MS8), für alle Gebäude mit B7 (Post-MVP). Zeiger-Etikett: „Glutkessel I ×4 · Ziehen = Linie · ⇧ weiterbauen · Rechtsklick Abbruch".
- Shift beim Loslassen: Modus bleibt, Aufträge werden an die Befehlskette gehängt (C5).
- Rechtsklick oder Esc bricht ab, ohne Befehl.

### 7.6 Befehlsausführung und Rückmeldung

Jede Eingabe erzeugt einen Command (S3); die UI ändert den Zustand nie selbst. Sofortige Rückmeldung ohne Sim-Rundlauf: Klickmarker in der Welt (Ring, Farbe des Befehls), UI-Klang (`ui_cmd_*`) ≤ 1 Frame, Zelle blitzt 140 ms. Bestätigt die Sim (seq-Ack), bleiben Wegpunkte stehen; lehnt sie ab (Platzierung ungültig), kommt `ui_error` und ein roter Ghost-Blitz.

### 7.7 Fokus und Menüs

Menüs: Pfeile bewegen, Enter bestätigt, Esc zurück, Tab springt zwischen Spalten. Fokus ist immer sichtbar (Keramikrahmen) und niemals nur Glut. Beim Öffnen landet der Fokus auf der Primäraktion.

---

## 8. Barrierefreiheit

### 8.1 Grundsatz: nie nur Farbe

| Information | Farbe | zusätzlich |
|---|---|---|
| Team | Teamfarbe | Minimap-Rand, Name, Startnummer; Einheiten zeigen Rolle/Tech über Form, Glyphe, Kerben (faction.md §6) |
| Kritisch / Warnung / Info / Erfolg | Rot / Orange / Blau / Grün | Achteck / Dreieck / Kreis / Kreis mit Haken, Text |
| Stall | Rot | Badge-Text „Stall · Flow 72 %", schraffierter Balken, Klang |
| HP kritisch | Rot | Schraffur, Zahl |
| Mass / Energy | Grünspan / Gelb | Raute / Flamme, feste Position (links/rechts) |
| Aktiv vs. Fokus | Glut vs. Keramik | Glutkante oben vs. vollständiger heller Rahmen |
| Besserer Wert (Score) | Glut | fett |

### 8.2 Teamfarben-Modi

| Modus | Farben | Wofür |
|---|---|---|
| **Hausfarben** (Standard) | faction.md §4.3, frei wählbar | Identität der Häuser |
| **Eigen/Feind** | eigen `#3d8bff`, verbündet `#27b5a0`, feindlich `#e8462f` | schnelle Freund/Feind-Lesung, unabhängig von der Lobbywahl |
| **Farbenblind-sicher** | `#0072b2` Blau · `#e69f00` Orange · `#56b4e9` Himmel · `#009e73` Blaugrün · `#cc79a7` Rotviolett · `#d7263d` Rot · `#aa3377` Purpur · `#ee6677` Rosa | Deuteranopie, Protanopie, Tritanopie |

**Messung** (`tools/cvd-check.py`, Simulation nach Machado 2009 mit Schwere 1,0, Abstand CIEDE2000, jeweils kleinstes Paar):

| Palette | normal | Deutan | Protan | Tritan | Slot 1 ↔ 2 (1v1, schlechteste Sicht) |
|---|---|---|---|---|---|
| Hausfarben | 17,0 (Grün–Oliv) | **2,6** (Blau–Violett) | **1,7** (Orange–Oliv) | 8,7 | 44,5 (Rot–Blau) |
| Farbenblind-sicher | 14,7 | 11,1 | 10,0 | 10,1 | 51,4 (Blau–Orange) |

Die Hausfarben sind für 1v1 (Slot 1/2 = Rot/Blau) ausreichend, im 8er-Feld aber für Farbenblinde nicht unterscheidbar. Die sichere Palette erreicht ≥ 10 unter allen Sichten; die Auswahl ist per Suche über Okabe-Ito-, Tol- und eigene Kandidaten entstanden, ohne die in faction.md verbotenen Töne (Blassgelb, Weiß, Grau, Schwarz). Orange und Rot liegen nahe am Glut-Farbton und schalten die Einheiten-Glut auf Weißglut (faction.md §4.3). Für die Score-Graphen besteht das 1v1-Paar Blau/Rot alle Prüfungen des Dataviz-Validators (Dunkelmodus); CVD-Orange liegt mit Helligkeit 0,75 über dem Band, bleibt aber wegen Direktbeschriftung und gestrichelter zweiter Serie zulässig.

**Empfehlung:** Die drei Modi schon mit A3 (MS9) liefern, obwohl P16 insgesamt Post-MVP ist: Aufwand ≈ 1 Tag (eine Palette mehr im Shader-UBO, eine Auswahl), großer Nutzen (Entscheidung UI-E5).

### 8.3 Kontrast und Größe

- Text ≥ 4,5 : 1 für alles Lesbare (`--text-lo` wurde dafür auf `#8a8074` = 4,9 : 1 angehoben); `--text-off` nur für deaktivierte Elemente.
- Kleinste Schrift 11 px @1,0 (Tasten, Badges); UI-Skalierung bis 1,5.
- Klickziele ≥ 34 px (Filter) bzw. 40 px (Befehle), Zellen 58 px.
- Option „Icon-Kontur verstärken" (3 px statt 2 px Graphit-Kontur).

### 8.4 Bewegung, Blitzen, Ton

„Bewegung reduzieren" (System/An/Aus): kein Pulsieren, kein Alert-Blitz, keine Kamera-Wackler (P14 später); Zustände bleiben über Rahmen und Symbole lesbar. Keine Flächen, die schneller als 3 Hz blinken. Alle Sprachansagen erscheinen auch als Text im Alert-Feed; der Stall ist gleichzeitig sicht- und hörbar.

### 8.5 Tastatur und Screenreader

Alle HUD-Knöpfe sind `<button>` mit `aria-label` inkl. Taste; die Command Card ist ein `role="grid"` mit Pfeiltasten-Navigation, wenn sie per Tab fokussiert wurde; Alerts in `aria-live`. Die Welt selbst ist nicht screenreader-tauglich (RTS-inhärent), Menüs und Auswertung vollständig.

---

## 9. Performance-Regeln

Ziel aus PLAN §3.4/MS4: **HUD ≤ 1 ms Main-JS pro Frame (p95)**, Minimap ≤ 0,5 ms (MS11), gesamt Main-JS ≤ 4 ms typisch.

### 9.1 Binding-Raten

Ein `HudScheduler` liest die Frame-Sektionen (PLAN §3.6) und schreibt Signals mit festen Raten. Komponenten binden Signals direkt in JSX (Preact Signals aktualisieren dann nur den Textknoten bzw. das Attribut, ohne Re-Render der Komponente).

| Daten | Rate | Weg |
|---|---|---|
| Eco (Speicher, Netto, Flow, Stall) | 10 Hz (pro Sim-Tick) | Signal → Text/`--v` |
| Bau-/Queue-Fortschritt | 10 Hz | nur `--v`/`--p` (transform) |
| HP, Vet, Befehlskette, Toggle-Zustände | 4 Hz | Signal |
| Minimap-Einheiten, Blips, Pings | 4 Hz | Canvas2D |
| Minimap-Fog | 2 Hz | Canvas2D |
| Minimap-Kamerarahmen | bei Kamerabewegung, rAF-gebündelt | eigene Overlay-Canvas |
| Timer, Cap, Idle-Zähler, Gruppen-Zahlen, Alert-Alter | 1 Hz | Signal |
| Auswahlstruktur, Command-Card-Seite, Tabs, Alerts, Banner | Ereignis | Re-Render der betroffenen Komponente |
| Tooltip-Inhalt | beim Öffnen, danach 4 Hz | ein wiederverwendeter Knoten |
| Budget-Overlay | 2 Hz | |

Raten laufen im Sim-Takt, nicht im Bildtakt: Bei ×3 Tempo bleibt Eco bei 10 Hz (jeder dritte Tick), bei Pause gibt es keine Updates außer Ereignissen.

### 9.2 Kein Layout-Thrash

- **Keine Layout-Lesezugriffe im Update-Pfad** (`getBoundingClientRect`, `offsetWidth`, `getComputedStyle`). Maße werden einmal per `ResizeObserver` bzw. beim Öffnen gemessen (Tooltip-Anker) und gecacht.
- **Schreiben gebündelt** in einem rAF des Schedulers; nie innerhalb von Pointer-Handlern auf Layout schreiben und lesen.
- **Feste Geometrie:** jedes Panel hat feste Breite/Höhe und `contain: layout paint style`; Zellen, Kacheln, Einzeleinheiten `contain: strict`. Ein Tick ändert nie die Größe eines Panels.
- **Zahlen:** tabellarische Ziffern, reservierte Mindestbreite in `ch`; Text nur setzen, wenn sich der formatierte String ändert.
- **Balken:** `transform: scaleX(var(--v))`, nie `width`. Zustände über Klassen (`is-stall`) oder CSS-Variablen auf Blattknoten, keine Inline-Styles auf Containern.
- **Animation** nur `opacity`/`transform`; kein `box-shadow`, `filter` oder `backdrop-filter` auf großen Flächen (Unschärfe über dem WebGL-Canvas erzwingt pro Frame einen Readback). Pulsieren über ein Pseudo-Element mit `opacity`.
- **Schriften** vorgeladen, `font-display: block` → kein Umbruch nach dem Laden.
- **DOM-Budget HUD ≤ 700 Knoten:** Einzeleinheiten ≤ 60, Typ-Kacheln ≤ 24 (+N), Queue ≤ 10 Blöcke, Alerts ≤ 3 + Zähler, Konsolen-Log virtualisiert (≤ 200 Zeilen im DOM). Strategic Icons als SVG-Sprite (`<use>`), nicht als Inline-Kopie pro Knoten.
- **Minimap:** Terrain einmal in eine Offscreen-Canvas, Fog/Einheiten auf eigene Ebenen, kein `getImageData`, keine Textdarstellung.
- **Ereignisse:** ein delegierter Pointer-Listener pro Panel; Hover über der Welt geht an das Picking (CPU, PLAN §3.7), nicht an DOM-Elemente.

### 9.3 Prüfung

- Playwright-Messung im Demo-Pfad (MS4): 400 Einheiten, 10 Hz Eco, geöffnete Flow-Details, Mehrfachauswahl mit 60 Einheiten → p95 HUD-Zeit aus `performance.measure` je Scheduler-Flush ≤ 1 ms; Layout-Shift- und Long-Task-Observer ohne Einträge durch das HUD.
- Test-Hooks: jede Komponente trägt `data-testid`; Zustände als Klassen (`is-stall`, `is-armed`) sind in E2E abfragbar.
- Context-Loss (P10): das HUD ist DOM und übersteht den Verlust ohne Neuaufbau; nur die Minimap-Terrain-Canvas wird neu gezeichnet, falls die Quelle aus WebGL stammt.

---

## 10. Preact-Struktur

```
packages/client/src/ui/
  tokens.css            ← ui-mockups/assets/tokens.css
  base.css              ← ui-mockups/assets/ff.css (Komponenten, Zustände)
  hud.css               ← ui-mockups/assets/hud.css (Layout)
  model.ts              HudModel: Signals (eco, selection, card, queue, alerts, status, groups, idle …)
  scheduler.ts          HudScheduler: Frame-Sektionen → Signals mit Raten aus §9.1, ein rAF-Flush
  hud/Hud.tsx           Wurzel, pointer-events-Regel
  hud/ResourceBar.tsx   ResourceMeter, FlowDetails
  hud/MatchStatus.tsx   MatchStatus, PauseBanner
  hud/AlertFeed.tsx     Alert
  hud/Minimap.tsx       imperativer Canvas-Renderer, 3 Ebenen
  hud/Selection.tsx     SelectionPanel, UnitDetail, SelectionGroups, SelectionUnits, FactoryDetail, OrderQueue
  hud/FactoryQueue.tsx
  hud/CommandCard.tsx   TechTabs, CardCell, Seiten aus roster/view-Daten
  hud/OrderBar.tsx      OrderButton, Befehlstabelle §5.8
  hud/Strip.tsx         SelectionFilter, IdleButton, ControlGroups
  hud/Tooltip.tsx       TooltipLayer, UnitTooltip, OrderTooltip, ResourceTooltip
  hud/Cursor.ts         Zeigerformen je FSM-Zustand
  input/keylayers.ts    Tastatur-Schichten §7.2, Layout-Beschriftung
apps/game/src/ui/
  App.tsx               Routing Menü ↔ Spiel
  MainMenu.tsx  SkirmishSetup.tsx  Settings.tsx  LoadingScreen.tsx (bestehend, erweitert)  ScoreScreen.tsx  GameMenu.tsx
  DevConsole.tsx        (bestehend, neues Aussehen)
```

- Klassen und Markup wie in den Mockups (`ff-cell`, `is-active`, `data-component` → Komponentenname). Die Mockup-Funktionen (`renderCard`, `resEl`, `unitTip` …) entsprechen 1:1 den Komponenten.
- Komponenten lesen nur `HudModel` und rufen nur `CommandBuilder` (S3) bzw. Kamera-/Auswahl-APIs auf; sie importieren nie `sim` (dependency-cruiser, PLAN §3.2).
- Texte ausschließlich über i18n-Keys (P12): `ui.hud.eco.flow`, `ui.order.patrol`, `unit.core.<id>.name/.role/.desc` (faction.md §7.3).
- Linien-Icons als ein SVG-Sprite (`ui/icons.svg`), Strategic Icons aus dem MSDF-/SVG-Bestand von `content/icons`.

---

## 11. Mapping: Komponente → Feature-IDs → Meilensteine

| Komponente | Feature-IDs | erster Auftritt | Ausbau |
|---|---|---|---|
| Dev-Konsole, Budget-Overlay | S8 | MS1 (vorhanden) | Aussehen nach diesem System in MS4 |
| Pause-Banner, Timer | A5, S1 | MS1 | S9 Hintergrund-Pause MS9, A6 Tempo MS11 |
| Ladebildschirm | P3 | MS2 (vorhanden) | Häuser, KI-Phase MS9 |
| Tastatur-Schichten, Vollbild, Kontextmenü | C11, C1 | MS2 | Raster-Schema MS4 (C8), Schema-Wahl P9 MS14 |
| Auswahlrahmen, Ringe, Auswahl-Zahl, Gruppen | C3, C7 | MS3 | Panel voll MS6 |
| Strategic Icons in HUD/Welt | C2 | MS3 | finale Icons MS9 (U3) |
| **Ressourcenleiste** | **C10**, E1–E4 | **MS4** | Flow-Details lesend MS4, Pause/Priorität E13 MS10 |
| **Command Card mit Tech-Tabs + Hotbuild-Raster** | **C8**, B1 | **MS4** | Produktion MS6, T2/Upgrade U5/B4 MS8, T3 U10 MS13, Rebinding C20 Post-MVP |
| Platzieren, Ghost-Verdikt | B1 | MS4 | Drag-Linie Mauern MS8, B7 Post-MVP |
| i18n aller Texte | P12 | MS4 | |
| Reclaim-Befehl, Sieg/Niederlage-Minimalbild | E7, A4 | MS5 | |
| Positions-Audio, UI-Klänge | P7 | MS5 | |
| **Auswahl-Panel, Tooltips** | **C9** | **MS6** | Vet U9 MS11, Schild K10 MS13 |
| **Fabrik-Queue** (+1, Shift +5, Repeat, Rally) | **B3**, B2 | **MS6** | Pause E13 MS10 |
| Befehlsleiste/Befehlsraster (Bewegen, Assist, Reparieren, Stop, Abstich) | C4, C5, S3, B2, U8, G4 | MS6 | Feuermodus/Boden K6 MS7, Angriff C6 MS8, Toggles C17 MS10, Patrouille C12 + Selbstzerstörung C18 MS11, Formation C13 MS13 |
| **Selection-Filter + Idle-Engineer** | **C14** | **MS6** | |
| Kontext-Rechtsklick + Cursor-FSM-Befehlsmodi | C4, C5 | MS6 | Formation-Drag C13 MS13 |
| Range-Ringe | C15 | MS8 | Radar/Schild MS10/MS13 |
| Unit-Cap-Anzeige | U7 | MS8 | |
| **Alerts mit Sprung zum Ort** | **P8** | **MS9** | Luft/Speicher-Alerts MS14 |
| **Hauptmenü, Gefecht einrichten**, Esc-Menü | **A3**, M8, U3, G12 | **MS9** | KI-Stufe A10 + AIx A11 + Siegbedingungen A12 MS14 |
| Teamfarben-Modi (Vorgriff P16) | P16 (Teil), P4 | MS9 (Empfehlung UI-E5) | |
| Nachbarschaft im Tooltip/Ghost, Fähigkeits-Toggles, Pausieren | E11, C17, E13 | MS10 | |
| Radar-Blips in Welt/Minimap | I3 | MS10 | |
| **Minimap** | **C16**, I1, I2 | **MS11** | |
| Sim-Tempo-Anzeige | A6 | MS11 | |
| Replays (Menü, Speichern im Score) | N1 | MS11 | Replay-Leiste im HUD (nicht Teil dieser Mockups) |
| **Einstellungen** Grafik/Audio mit Autodetect | **P9** | **MS14** | Preset-Infrastruktur seit MS2 |
| **Score-Screen** | **A13** | **MS14** | |
| KI-Stufen/AIx in der Lobby | A10, A11 | MS14 | KI-Manager A1/A2 MS9, A7/A8 MS11, A9 MS10 (nur Verhalten, keine eigene UI) |
| Live-Punkte im Status | A19 | Post-MVP | im MVP ausgeblendet |

**KI-Bezug (A1/A2/A7/A8/A9/A10):** Die KI hat keine eigene Spieler-UI. Sichtbar wird sie in der Lobby (Stufe, AIx, Profilkarte mit Reaktionszeit/Micro/„schummelt nie bei Sicht"), im Ladebildschirm (KI-Worker-Phase), im Pause-Banner (Sim wartet auf `pending`-KI) und in der Dev-Konsole (Overlays Threat-Map A7, Platoons A2). Empfohlene Konsolen-Overlays: `overlay threat`, `overlay platoons`, `ai <army> plan`.

### 11.1 Ausbaustufen des HUD je Meilenstein

| Stand | Sichtbar |
|---|---|
| MS3 | Status (Timer), Pause-Banner, Auswahl-Zahl, Gruppen, Konsole |
| MS4 | + Ressourcenleiste, Command Card (Bau-Seite, T1), Platzieren, Tooltips minimal |
| MS6 | + Auswahl-Panel voll, Fabrik-Queue, Befehlsleiste (Q/E/T/S/X), Filter + Idle, Kontext-Cursor |
| MS8 | + T2-Tabs/Upgrade, Angriff, Range-Ringe, Cap |
| MS9 | + Alerts, Menüs, Lobby, Esc-Menü, Teamfarben-Modi, finale Icons |
| MS10 | + Flow-Details interaktiv, Toggles, Nachbarschaft, Blips |
| MS11 | + Minimap, Patrouille, Selbstzerstörung, Vet, Tempo, Replays |
| MS13 | + Formation, Schilde, T3 |
| MS14 | + Einstellungen komplett, Score-Screen, KI-Stufen/AIx |

---

## 12. Mockups und Screenshots

Öffnen: `docs/design/ui-mockups/index.html` direkt im Browser (klassische Scripts, funktioniert auch über `file://`).

**HUD-Parameter** (`hud.html?…`): `sel=vogt|army|factory|none` · `stall=1` · `flow=1` · `paused=1` · `speed=2` · `console=1` · `place=1` · `tip=<Taste>` · `ring=1` · `teams=cvd|relation` · `scale=1.25` · `clean=1` (ohne Mockup-Leiste). Im HUD funktionieren: Rastertasten (Zelle wird aktiv bzw. Queue +1/+5 mit Shift), Alt+Taste (Befehl scharf), Esc, P, 1–4 (Gruppen), H, Leertaste (Alert-Ping), F1/`^` (Konsole), Hover über Zellen (Tooltip), Klick auf Gruppen.

**Screenshots erzeugen:**

```bash
PLAYWRIGHT_FROM=<pfad>/node_modules/.pnpm/playwright@<v>/node_modules/playwright/index.js \
  node docs/design/ui-mockups/tools/shoot.mjs /private/tmp/claude-501/faf-ui [filter]
```

Das Skript startet einen eigenen statischen Server auf einem freien Port, fotografiert 20 Ansichten (1920 × 1080 und 2560 × 1440, Komponentenseite ganzseitig), meldet Script-Fehler pro Seite und beendet Browser und Server. Die Bilder werden nicht eingecheckt.

| Datei | Inhalt |
|---|---|
| `hud-1080-vogt.png` | Vogt baut Glutkessel mit Befehlskette, Tooltip Glutkessel mit Nachbarschaft |
| `hud-1080-armee.png` | 19 Einheiten, Typ-Kacheln + Einzeleinheiten, Befehlsraster, Angriffsziel |
| `hud-1080-fabrik-stall.png` | Landwerk mit Queue, Energy-Stall, Flow-Details, Tooltip Punze |
| `hud-1080-platzieren.png` | Drag-Build von 4 Glutkesseln, Nachbarschaft, ungültiger Platz |
| `hud-1080-konsole.png` | Dev-Konsole mit Autovervollständigung und Tick-Budget |
| `hud-1080-pause-cvd.png` | Pause, farbenblind-sichere Teamfarben, Range-Ring |
| `hud-1440-vogt.png`, `hud-1440-fabrik.png`, `hud-1440-kompakt.png` | 1440p bei 1,25 und 1,0 (mit Tempo-Banner) |
| `menu-1080.png`, `skirmish-1080/1440.png`, `settings-1080-{grafik,tasten,zugang}.png`, `loading-1080.png`, `score-1080/1440.png` | Menüs |
| `components.png`, `index.png` | Komponentenübersicht, Einstieg |

---

## 13. Offene Entscheidungen

| # | Entscheidung | Optionen | Empfehlung |
|---|---|---|---|
| UI-E1 | **Tastenschema** | (a) Raster-Standard: Buchstaben = Raster, Kamera über Pfeile/Rand/Mitte, WASD nur ohne Auswahl, WASD-Schema wählbar. (b) WASD-Standard, Raster mit Alt | **(a).** Hotbuild ist Kern von C8 und FA-Komfort; Kameraführung läuft im RTS ohnehin über Maus und Strategic Zoom. Ändert `DEFAULT_ACTION_MAP` (WASD, S) in MS4. |
| UI-E2 | Übersicht vor MS11 | (a) Dock-Platz der Minimap zeigt bis MS11 Kartenkennzahlen. (b) C16 auf MS9 vorziehen (≈ 1–1,5 PW) | **(a)**, Strategic Zoom reicht bis MS11; die Minimap bleibt bei MS11. |
| UI-E3 | Punkte im Status | (a) im MVP ausblenden (A19 Post-MVP). (b) nur eigene Punkte | **(a)**; das Feld bleibt im Layout reserviert. |
| UI-E4 | Schriften | (a) IBM Plex Sans Condensed + Mono selbst gehostet (OFL, ≈ 120 KB woff2 Subset). (b) Systemschriften | **(a)**, feste Metrik ist Voraussetzung für §9.2. |
| UI-E5 | Farbenblind-Modus vorziehen | (a) drei Teamfarben-Modi in MS9. (b) mit P16 Post-MVP | **(a)**, ≈ 1 Tag. |
| UI-E6 | Beschriftung nach Layout | (a) `getLayoutMap` + Sprachtabelle. (b) immer QWERTY-Buchstaben | **(a)**; DE-Spieler sehen „Y" auf der unteren Reihe. |
| UI-E7 | Selbstzerstörung | (a) Strg+Entf mit 5-s-Countdown. (b) Entf halten 1 s | **(a)**, browser-sicher und nicht versehentlich auslösbar. |
