import { expect, test } from './support/silent-test.ts';
import { attachJson, captureErrors, SERVERS, expectNoErrors, HOLLOW_RIDGE, openGame, waitTick, writeReport } from './support/game.ts';
import { settle } from './support/terrain.ts';

// Picking (G15): the heightmap raymarch used for right clicks (`pickAt`) against a high-resolution
// float64 reference (1/64 WU march + 40 bisections against the same bilinear surface) on ≥ 200
// screen points in several views (start view, oblique over the mesa cliffs, rotated view over the
// river): |Δxz| ≤ 1/16 WU and |Δy| ≤ 1/16 WU. A real right click sends exactly the picked point
// (Move payload x/y/z raw == pickAt raw).

const LIMIT_WU = 1 / 16;
const VIEWS = [
  { name: 'start', x: HOLLOW_RIDGE.own.x, z: HOLLOW_RIDGE.own.z, d: 105, yaw: null },
  { name: 'mesa-cliffs', x: 120, z: 250, d: 45, yaw: null },
  { name: 'river-rotated', x: 300, z: 212, d: 80, yaw: 2.3 },
  { name: 'overview', x: 256, z: 256, d: 400, yaw: null },
] as const;

for (const server of SERVERS) {
  test(`picking: ≥ 200 Bildschirmpunkte ≤ 1/16 WU, Rechtsklick-Ziel == Pickpunkt – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1024);
    await waitTick(page, 5);
    const vp = page.viewportSize()!;

    const perView: { name: string; compared: number; maxXz: number; maxY: number; misses: number; pickerMisses: number; falseHits: number; missSamples: unknown[] }[] = [];
    let compared = 0;
    let worst = { dxz: 0, dy: 0 };
    for (const v of VIEWS) {
      await page.evaluate((view) => {
        const h = window.__faf!;
        h.setCamera(view.x, view.z, view.d);
        h.setYaw(view.yaw ?? h.camera().yaw);
        h.setCamera(view.x, view.z, view.d);
      }, v);
      await settle(page);
      // 12 × 8 grid, away from the HUD (top left) and the edge-pan band.
      const r = await page.evaluate(
        ({ w, hgt }) => {
          const h = window.__faf!;
          const out = {
            compared: 0,
            maxXz: 0,
            maxY: 0,
            // Both miss the terrain (e.g. beyond the map edge): consistent.
            misses: 0,
            // Reference hits, picker misses (e.g. a chunk skipped by the DDA): must be 0.
            pickerMisses: 0,
            // Reference misses, picker reports a terrain hit: must be 0.
            falseHits: 0,
            missSamples: [] as { px: number; py: number; pick: unknown; ref: unknown }[],
            samples: [] as { px: number; py: number; dxz: number; dy: number }[],
          };
          for (let j = 0; j < 8; j++) {
            for (let i = 0; i < 12; i++) {
              const px = 320 + ((w - 340) * (i + 0.5)) / 12;
              const py = 20 + ((hgt - 40) * (j + 0.5)) / 8;
              const p = h.pickAt(px, py);
              const ref = h.pickReference(px, py);
              const pickHit = p !== null && p.hit;
              if (ref === null || !pickHit) {
                if (ref === null && !pickHit) out.misses++;
                else {
                  if (ref !== null) out.pickerMisses++;
                  else out.falseHits++;
                  if (out.missSamples.length < 4) out.missSamples.push({ px, py, pick: p, ref });
                }
                continue;
              }
              const dxz = Math.hypot(p.x - ref.x, p.z - ref.z);
              const dy = Math.abs(p.y - ref.y);
              out.compared++;
              out.maxXz = Math.max(out.maxXz, dxz);
              out.maxY = Math.max(out.maxY, dy);
              if (out.samples.length < 4 || dxz > 1 / 32 || dy > 1 / 32) out.samples.push({ px, py, dxz, dy });
            }
          }
          return out;
        },
        { w: vp.width, hgt: vp.height },
      );
      perView.push({ name: v.name, compared: r.compared, maxXz: r.maxXz, maxY: r.maxY, misses: r.misses, pickerMisses: r.pickerMisses, falseHits: r.falseHits, missSamples: r.missSamples });
      compared += r.compared;
      worst = { dxz: Math.max(worst.dxz, r.maxXz), dy: Math.max(worst.dy, r.maxY) };
    }

    // Right click target == pick point (camera at rest in the start view).
    await page.evaluate((o) => {
      const h = window.__faf!;
      h.setYaw(0);
      h.select(null);
      h.setCamera(o.x, o.z, 105);
    }, HOLLOW_RIDGE.own);
    await settle(page);
    const clicks: { px: number; py: number; pick: unknown; sent: unknown; equal: boolean }[] = [];
    for (const [px, py] of [
      [700, 300],
      [900, 520],
      [520, 600],
      [1100, 200],
      [640, 360],
    ] as const) {
      const before = await page.evaluate(() => window.__faf!.lastMoveTarget()?.seq ?? -1);
      const pick = await page.evaluate(({ x, y }) => window.__faf!.pickAt(x, y), { x: px, y: py });
      await page.mouse.click(px, py, { button: 'right' });
      await page.waitForFunction((s) => (window.__faf!.lastMoveTarget()?.seq ?? -1) !== s, before);
      const sent = await page.evaluate(() => window.__faf!.lastMoveTarget());
      const equal = pick !== null && sent !== null && pick.raw.x === sent.x && pick.raw.y === sent.y && pick.raw.z === sent.z;
      clicks.push({ px, py, pick, sent, equal });
      // Camera must not have moved (no edge pan): the same pixel still picks the same point.
      const again = await page.evaluate(({ x, y }) => window.__faf!.pickAt(x, y), { x: px, y: py });
      expect(again?.raw).toEqual(pick?.raw);
    }

    const report = { browser: testInfo.project.name, server: server.name, limitWU: LIMIT_WU, compared, worst, perView, clicks };
    writeReport(`picking-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'picking', report);
    expect(compared).toBeGreaterThanOrEqual(200);
    // A miss is only acceptable where the reference misses too (and vice versa).
    for (const v of perView) {
      expect(v.pickerMisses, `${v.name}: reference hit, picker missed ${JSON.stringify(v.missSamples)}`).toBe(0);
      expect(v.falseHits, `${v.name}: reference missed, picker hit ${JSON.stringify(v.missSamples)}`).toBe(0);
    }
    expect(worst.dxz).toBeLessThanOrEqual(LIMIT_WU);
    expect(worst.dy).toBeLessThanOrEqual(LIMIT_WU);
    for (const c of clicks) expect(c.equal, JSON.stringify(c)).toBe(true);
    expectNoErrors(errors);
  });
}
