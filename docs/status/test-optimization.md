# Test execution, 2026-10-02

The regular development command retains the functional, property, golden and
replay checks. The two allocation stress suites now have a separate project.
`pnpm test:allocation` runs their original five cases and original workloads
serially; `pnpm test:full` and `pnpm ci:local` include them. Direct `vitest run`
also runs both projects. Discovery found the same 345 test files before and
after partitioning, with 343 in `unit` and two in `allocation`.

Vitest persists transformed modules between runs and shares one Vite server,
while keeping process forks and file isolation. Worker concurrency remains
four for the regular suite. `test:changed` and `test:watch` provide narrower
development runs without changing the full gate.

Repeated work was removed within individual test files: identical map routes,
an immutable AI baseline, repeated scenario recording and one duplicate
replay seek. Snapshot tests keep hashes captured before snapshotting, and
replay verification still compares against an independent forward player.
Byte comparisons use native `Buffer.compare`, preserving exact equality.
No simulation durations, property sample counts or golden assertions were
reduced.

## Local measurements

Measured with `/usr/bin/time -l` on an Apple M5 Pro with 48 GiB RAM. CPU time is
user plus system time. Large commands ran serially through `tools/heavy`.
The normal run omits the five separately retained allocation stress cases,
so these numbers describe the development command, not an equal-workload
speedup of the complete gate.

| Run | Passing tests / files | Wall time | CPU time | Recorded maximum RSS |
| --- | --- | --- | --- | --- |
| Original full suite | 3,478 / 345 | 346.52 s | 1,422.46 s | 4.63 GiB |
| Optimized normal suite, initial cache | 3,473 / 343 | 276.67 s | 942.38 s | 2.77 GiB |
| Optimized normal suite, final test revision | 3,473 / 343 | 270.54 s | 1,051.61 s | 2.75 GiB |

The final normal run took 21.9% less elapsed time and 26.1% less CPU than the
original full command. Recorded maximum RSS was 40.7% lower. Both normal runs
had zero failed or skipped tests. The final run occurred while the user was
also inspecting the menu; the CPU variance does not establish a separate
cache speedup or a strict performance qualification.

The original baseline passed all five allocation checks. Their source and
budgets are unchanged. A focused allocation canary subsequently passed in
the new project, verifying that allocation measurement and exposed GC still
work; the four stress cases were intentionally outside that focused run.

## Browser execution

`test:e2e` builds game content and the game rather than all unrelated workspace
applications. The silent-audio fixture creates a default page only when a
test uses it; manually created pages retain explicit silent setup. Traces
retain DOM and ARIA snapshots without repeated frame screenshots or source
bundles. Failure screenshots and explicit visual captures remain available.
Cold and cached loads, all three browser engines and both transport modes
remain covered.

Qualification exposed a real duplicate initial asset load: `boot()` loaded
the session, then `startSession()` loaded it again. Initial startup now reuses
the verified assets only for the same map. Later session and map changes
still load through the asset store. This avoids duplicate hashing, decoding
and progress resets and lets the native cold-load check measure the first
load rather than the immediately repeated cache load.

The final built-game run passed all 18 selected native cases across Chromium,
Firefox and WebKit, including six cold/cache checks and byte-identical SAB
and transfer frames. Typecheck, lint, the focused allocation canary and the
new content/game-only E2E build passed. The later menu camera change passed
538 focused game/HUD tests and the native motion/pause checks. No browser
test connected its audio graph to hardware output.

The browser run took 88.30 s and 102.40 CPU seconds. Its earlier 71.97 s run
had six failures, and the final run also exercises the additional camera
and atmosphere checks. It is a correctness qualification, not evidence of
an equal-workload browser speedup.

Detailed measurements and validation are recorded in
[test-optimization-receipt.json](test-optimization-receipt.json).
