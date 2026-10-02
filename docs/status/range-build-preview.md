# Range rings and building drag preview

Selected units show their blueprint sight, radar, weapon maximum/minimum and
builder work radii. Rings follow terrain and camera movement, including paused
games. Enhanced commander blueprints supply their current weapon ranges.
Planned, incomplete and inactive coverage uses dashed lines with status labels.
Placement shows the current site's ranges; selection is bounded to four sources
to keep the battlefield readable. Hidden enemy contacts do not expose ranges.

Shift + left-button drag shows raised, role-colored building volumes. Blocked
footprints are hatched red and skipped on release. Dragging a generator grid
over an existing mex queues the free surrounding sites and keeps the mex.
Already accepted future building footprints are reserved, including sites
outside the camera. Dragging the same area again does not add duplicate orders.
Accepted future sites retain subtle dashed volumes until their real mesh exists.

The simulation and blueprint content are unchanged. Qualification also repaired
the missing enhanced Reeve cannon sound mapping and the compiled locale fixture
list, retaining strict sound and translation assertions.

Validated source build: `d107f97a74ea`.
The [receipt](../design/range-build-preview-2026-10-02/receipt.json) contains actual
native range radii, camera geometry hashes, build queues, unchanged mex HP and
audio audits. The building test uses the original skirmish commander and a
completed native Build on a real mass spot, without cheats.

- 804 UI/client/audio tests passed. The final caption refinement passed all nine
  focused range tests again.
- Six final native cases passed in Chromium, Firefox and WebKit, with zero
  speaker or blocked audio connections, no runtime errors and no retries.
- The earlier twelve-case native run also passed the 32-site grid cap, command
  deduplication and Escape/right-click/Pause cancellation in all three engines.
- Typecheck, full lint and production build passed.

[Radar screenshot](../design/range-build-preview-2026-10-02/radar-ranges.png) ·
[Generator grid around a mex](../design/range-build-preview-2026-10-02/build-grid-around-mex.png)

Local game: <http://127.0.0.1:5295/?menu=1>.
