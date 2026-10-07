# Gefecht setup, 2026-10-02

The setup screen continues the main menu's generated Commander scene, logo
and layered camera movement. Dark translucent panels, lighter borders and
player-color accents keep the forms readable against the artwork. Main and
setup share one backdrop instance; starting a game removes the scene. The
existing animation setting, visibility pause and reduced-motion preference
apply to both screens. No additional artwork or animation loop was needed.

A larger square relief and compact map choices sit beside clear player
cards and the essential rules. AI economic bonuses and less frequent rules
are in native collapsible sections. The footer keeps Back, validation and
Start reachable. On phones the map and player cards scroll in one column,
without overlap. Start markers show actual occupied player colors; unused
positions are neutral. Start swapping, validation and simulation defaults
retain their existing behavior.

Qualified build: `fe36046fb0cb-de87f019b`.

- 538 focused game/HUD tests passed in 64 files.
- All 12 native cases passed in Chromium, Firefox and WebKit: nine adjacent
  main-menu cases and three setup cases on the same final build, no retries.
- Setup checks cover 1440x900, 390x844 and 1024x600 layouts, panel separation,
  square relief, pointer reachability, keyboard start swapping, player-color
  validation, option retention and an actual game start.
- Shared artwork loading and active/reduced motion were checked. Gameplay
  starts without the backdrop. Audio tests verified zero speaker connections.
- Typecheck, lint and the production build passed.

[Final screenshot](../design/skirmish-cleanup-2026-10-02/after.jpg),
[phone screenshot](../design/skirmish-cleanup-2026-10-02/skirmish-390x844.png),
[native receipt](../design/skirmish-cleanup-2026-10-02/receipt.json).

Local review: <http://127.0.0.1:5295/b/fe36046fb0cb-de87f019b/?menu=1>.
