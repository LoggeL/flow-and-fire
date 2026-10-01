# Real Sim AI qualification

Run serially from the repository root, after other heavy jobs finish:

```sh
./tools/heavy pnpm exec vitest run packages/sim-host/test/game-ai.test.ts packages/sim-host/test/game-ai-metrics.test.ts --maxWorkers=1
./tools/heavy pnpm exec vite build -c apps/game/test/ai-qualification/vite.config.ts
./tools/heavy pnpm exec playwright test -c apps/game/test/ai-qualification/playwright.config.ts
```

The dedicated build writes `apps/game/dist-ai-qualification`, including a SHA-256 receipt of the production Sim, AI, host, dependencies, current compiled content, harness and silent-output guard. The spec serves that frozen directory without a development server and rejects changed source before comparing it with synchronous Node execution. Playwright uses one worker and runs Chromium, Firefox and WebKit serially. Expect about 21 minutes, with additional time possible for initialization and synchronous Node work.

Every browser run instantiates production `startSimWorker`, `SimHost`, `Scheduler` and the real compiled Sim. AI sources use the actual child-worker entry and default 40 ms emergency timeout. Normal/Hard think intervals, lead 3, maxMs 9 and default arena limits remain those of production. The synchronous Node reference uses the same brain, wire data and production Sim with the original 200 ms headless timeout.

The cases retain JSON samples and command logs before applying their gates:

- Normal versus Normal, 3000 real ticks at 3x. Fewer than 1% distinct blocked tick IDs and worker think p95 at most 8 ms. Retries are reported separately.
- Hard versus Hard, 300 actual T1 tanks per side plus the native commanders, 600 ticks at 3x. Actual result op p99 must fit each profile cap and no result may abort. A fresh browser Sim with human controller labels replays every accepted command byte at the same tick. Exact command bytes, hash trail and final full/rule hashes must agree. The direct native whole-Sim-step stopwatch p95 must differ by at most 2%, including both positive and negative variance. Sources, recorder and scheduler retries are outside that timer. Both sides run the complete same workload; failures remain evidence.
- Seed 7, Setons, two Normal AIs, 6000 ticks. Browser child workers and synchronous Node AiHost must emit exactly the same accepted command bytes, full hash trail and final hashes. The original 600-tick checkpoints are also checked explicitly. Node starts after the browser workload ends.
- A separate two-core capability override executes the same production brain inline in the Sim worker. Its actual hardware concurrency and overridden policy value are recorded separately. This checks the policy path on the reference machine; it does not claim a physical two-core hardware result.

Each page installs the existing hardware audio destination guard before navigation, validates a silent stream sink canary and checks the guard again at teardown. The harness has no audio producers. Early match termination, missing timing, dropped observation IDs or samples, unexpected native routes and emergency aborts fail qualification. The harness proves isolated native Sim/AI execution. Game UI integration must be qualified with a later build of the actual game.
