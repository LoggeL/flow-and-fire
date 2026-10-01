# Compact game HUD, articulated units and cursors

The subsequent building, fog, walking, upgrade and ImageGen work is documented in
`game-ui-building-fog-upgrades.md`. The build and native results below describe the
earlier compact-HUD qualification and are retained as historical evidence.

Status: 2026-09-30. The user requires a minimal adaptation of an actual original
Forged Alliance screenshot. The previous generated interpretations are superseded.
The matching game skin is implemented. Build `b411bee7eaa2-de4fd6c56` passes all
21 native browser cases across Chromium, Firefox and WebKit, with no skips or retries.

The built-in ImageGen tool generated the design reference in
`docs/design/ui-concepts/forged-alliance-original-adapted-v3.png` by editing the genuine
gameplay screenshot retained in `references/supreme-commander-fa-gamesurge-air.jpg`.
The source page is https://www.gamesurge.com/pc/reviews/scforgedalliance-2.shtml.
The exact editing prompt and settings are retained in
`forged-alliance-original-adapted-v3-prompt.txt`. The v1/v2 references remain as design
history. The adapted screenshot is a design reference; actual gameplay continues
to draw the existing game terrain and models.

The game HUD follows the original narrow pale-cyan bevels and dark translucent panels,
with stacked green mass and amber energy meters. Compact contextual orders appear
at the lower left, with real text-only selection information adjacent to their right.
Single-unit health, multiple unit types and counts, construction and production
remain connected to actual state. Most of the bottom edge remains clear battlefield.
No minimap, unit portraits, unit pictures, full-width dock or empty command cards are
mounted. Empty selection controls are absent; populated control groups remain usable.
A Details disclosure exposes secondary unit statistics and helper/rally information.
Factory queues retain progress, nullable ETA and pause/repeat/rally/clear controls.
Replay keeps queue observations visible and disables queue editing. Existing menus,
commands and real observations remain connected to the game.

Units retain the original GLB hierarchy, pivots and rest poses. A read-only Frame
extension exports actual combat-mount yaw and elevation. A bounded client adapter
expands those channels into mesh-part poses: tank turret/barrel, artillery boom/ladle,
commander torso/barrel and both heavy turrets. Hull heading remains authoritative.
The adapter clears pose history on lost/hidden targets, rewind, viewer changes,
generation changes and model reload. It preserves legacy direct part records.
Frame export does not alter simulation hashes or combat rules. The heavy unit retains
its existing secondary weapon arc. Mesh-level muzzle alignment is not claimed.

The native canvas cursor and the existing pointer-lock virtual cursor share the same
crisp SVG art and hotspots. Cursors cover selection, movement, armed combat/support
orders, valid/blocked placement, box selection, camera pan/rotation and eight edge
directions. Cursor state uses accepted visible Frames and the actual input state.

The rotation changes pass 42 focused tests in seven files, source/test typechecks,
and scoped lint. The preceding combined builds pass global typechecks, ESLint, package
boundaries and focused HUD/cursor/model/worker tests. A corrected checkout fingerprint
includes actual contents of new files and sibling packages; three temporary Git-fixture
tests prevent the previous app-relative path collision. The superseded d50311499
identity is not used for fresh native acceptance. The replacement has its own
checkout fingerprint and completed common/native receipts. The Replay worker's
implementation is now imported without starting a second simulation host; focused
worker-entry tests prove that distinction. Main-menu navigation waits for loading
to finish so initial map/config population cannot reset an early setup selection.
HUD actions synchronize the current client selection before resolving a key or card
activation, preventing a subsequent presentation update from cancelling a newly armed
build or order. Three regression cases prove immediate build/card/patrol behavior.

Opening a menu now cancels an active camera grab, selection box, edge pan and held keys
before the physical mouse button is released. It emits the existing grab-end action
once and cannot commit a cancelled box selection. Four focused input regressions and
the unchanged native held-middle-button Escape test cover this behavior.
An idle builder displaced out of its unchanged build range by normal separation now
repaths the same order and construction site. A real-World regression reproduces that
loss of contribution and completes the shared head after the other builder dies.
The previous Firefox native failure did not retain enough position/progress data to
prove its cause; its receipt remains a failure. The new native takeover case passes
on all three engines and retains bounded accepted-state diagnostics.

The combined native suite tests all three Playwright engines with one worker and
silences real audio contexts before each navigation. It covers compact layouts at
1440×900 and 1280×720, native multi-selection, cursors and camera interactions, real combat joints,
skirmish construction/production/end menus, Replay import/seek/perspective, shared
build queues and terrain/water Fog with both transports. The visible minimap assertions
were replaced with absence checks after the user's removal request; no new minimap
runtime acceptance is claimed. Its combat joint fixture uses real Spawn
commands and is explicitly tainted; it is separate from the ordinary skirmish flows.
The complete R6 run passes all 21 cases in 333 seconds. Each engine captures eight
actual layouts and checks all eight native edge directions without a focus exception.
Real factory production creates the engineer used in native three-type Shift selection.
The current common checks pass source/test TypeScript, ESLint, package boundaries and
85 focused cases in 15 files. The final actual game screenshot is retained separately
as `docs/design/ui-concepts/flow-and-fire-fa-hud-native-multi.png`.
Immutable reports, sources, manifests, screenshots, receipts and SHA-256 inventories
are under `.git/integration-goal/browser-acceptance-20260930-161138-r6`.
The local server on port 5199 serves this exact build, its JavaScript and CSS with
HTTP 200 and COOP/COEP headers. The test servers on 4183/4184 are closed.

The broader integration Goal remains active. Strict timing gates, a real ten-minute
OPFS crash/recovery run and final common verification remain separate work.
