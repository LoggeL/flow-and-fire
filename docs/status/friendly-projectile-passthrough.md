# Allied projectile passage

Own and allied live units and buildings let projectiles pass through. Direct
impacts and area damage spare allies, using the projectile's stored army and the
world's alliance matrix. This also works after the firing unit dies.

Enemy units still intercept shots, with the nearest hostile blocker taking the
hit. Terrain and wrecks remain physical obstacles.

The simulation version is now
`faf-sim/ms6.5-allied-projectile-passthrough`. Blueprint stats and the content
hash `0x02629d13` are unchanged. The official tools refreshed all nine golden
scenarios, command logs and replays for the new simulation version; their hash
chains and final hashes remain unchanged.

## Validation

The tested source build is `ed5792d61f61`. The compact
[receipt](friendly-projectile-passthrough-receipt.json) records the actual native
HP readbacks, browser engines and audio audits.

- 24 focused simulation combat tests passed. These cover own and allied blockers,
  hostile interception, artillery and Overcharge splash, and deterministic
  snapshot continuation when the shooter dies with a projectile in flight.
- All 410 simulation, SimHost and headless tests passed across the suite run and
  the focused rerun after fixture regeneration. The initial run had 365 passes
  and 45 old-version fixture failures; both affected replay test files then
  passed all 48 tests with the refreshed fixtures.
- Nine native game tests passed in Chromium, Firefox and WebKit, with no skips,
  retries or failures. Six check projectile passage and artillery splash; three
  retain the actual tank/barrel/heavy-turret combat animation coverage.
- The native tests used the real skirmish menu, an explicitly tainted Spawn
  fixture, canvas attack commands and published simulation frames. Friendly HP
  stayed full while the enemy took the expected hit.
- Audio was redirected before navigation. All six new native receipts report
  zero speaker connections and zero blocked connections. The three existing
  animation tests also passed their silent-output assertion.
- Typecheck, full lint and the production build passed.

Native HP is a floored byte fraction rounded back to the unit's HP range. A
90-HP artillery hit on a 400-HP target therefore displays 309 HP. The test checks
that exact published value.

Implementation: [combat.ts](../../packages/sim/src/combat.ts).
Regression tests: [simulation](../../packages/sim/test/friendly-pass-through.test.ts)
and [native game](../../test/e2e/friendly-pass-through.spec.ts).

Local game: <http://127.0.0.1:5295/?menu=1>.
