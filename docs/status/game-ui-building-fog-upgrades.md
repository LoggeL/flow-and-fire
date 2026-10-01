# Building controls, visibility and commander upgrades

Status: 2026-10-01. This extends the compact Forged Alliance HUD described in
`game-ui-rigs-cursors.md`. The broader integration Goal remains active.

Build `b411bee7eaa2-dd7dd8d92` passes all 24 native browser cases in Chromium,
Firefox and WebKit (294.8 seconds), with no skips or retries. The final receipt is
`.git/integration-goal/ui-extensions-20260930/native-r5/qualification.json`.
It retains 42 native attachments, source and compiled hashes, all final common
checks and the actual layouts. Port 5199 serves this exact checked build. Native
Brave UI access timed out; these results do not claim Brave qualification.

An armed building can be placed with a normal click, Shift-click or Shift-drag.
Dragging previews a footprint-spaced line or rectangle, capped at the simulation's
32 orders per builder. Only valid, distinct sites are submitted on release. Mixed
selections send those orders to eligible builders. Accepted Frame orders and actual
construction sites supply the subsequent queued previews. Escape, right click,
Pause, focus loss and modal opening cancel a held gesture. Native checks found and
fixed mouse-button chord handling and the extra Shift on the configured pause key.

The original ACU's left and right hip joints now move in opposite directions as
accepted Frames report horizontal travel. The four-world-unit gait cycle is bounded
to 24 degrees and returns to rest when the unit stops. It does not write simulation
state or synthesize weapon targeting. Existing torso/barrel aim and upgraded ACU
model bindings remain independent.

Terrain starts visually explored. Current vision cells stay bright; other cells are
dim. Nearest-cell sampling preserves the square boundaries. This presentation copy
does not reveal enemy units or change authoritative vision, events or replay state.

Build tiles show the existing strategic symbols and have at least 44-pixel targets.
Progress bars sit below their labels, avoiding the CSS cascade that put idle tracks
across their icons. All 14 compiled runtime unit IDs resolve to existing HUD glyphs,
including upgraded commanders and the heavy tank. Notices retain their real type,
subject and actions in a compact row. There are no unit portraits or minimap.

The ACU upgrade row is visible without opening Details. Engineering costs 300 mass
and 3000 energy, increases build power from 10 to 20 and maximum HP from 12000 to
16000. Reinforced armor then costs 400 mass and 5000 energy and raises maximum HP
to 24000. Real Upgrade orders pay proportionally, pause or stall with the economy,
and preserve the same unit handle and pose on completion. Cancelled payment is not
refunded. Replay observations and foreign inspection cannot edit these orders.
The simulation identity is `faf-sim/ms6.1-upgrades`, simHash `0x8321662B`.

ImageGen is a required step in the Goal. The built-in image tool generated three
transparent originals: the favicon, engineering wrench/gear and armor shield. Their
originals and exact prompts are in `docs/design/ui-assets/imagegen-manifest.json` and
`docs/design/ui-assets/source/`. Runtime derivatives are the 32-pixel versioned
favicon and two 64-pixel PNGs shown at 32 pixels in the upgrade row. Existing SVG
unit/building symbols and cursor art remain the common strategic language. The
runtime inventory found no additional missing graphics.

Validation records are retained in `.git/integration-goal/jobs/` and
`.git/integration-goal/ui-extensions-20260930/`. Focused tests cover the genuine
economy, upgrade completion, cancellation, snapshot restore, recorded Upgrade
commands, durable and portable replay, rewind, identical hashes, rig history,
presentation-only terrain reveal and compiled icon coverage. Browser qualification
uses original skirmish commanders and real controls, accepted Frames, both fog
transports, final icon sizes and compact layouts in all three Playwright engines.
Every test page disconnects realtime audio from hardware before navigation. Failed
runs are retained separately; the final native receipt records the actual build,
engines, results, source files and compiled file hashes.

Current content changes require renewed current goldens and common integration
verification. Historical builds and MS1/MS2 evidence remain separate. Strict timing,
GPU and remaining original Goal gates are not closed by these UI checks.
