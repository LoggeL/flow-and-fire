import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, SERVERS, expectNoErrors, HOLLOW_RIDGE, openGame, waitTick, writeReport } from './support/game.ts';
import { settle } from './support/terrain.ts';

// FA camera and input (C1, C11, G16) on hollow-ridge:
// - keyboard: WASD/arrows pan, KeyH jumps to the own start, Home resets the rotation; hotkeys are
//   looked up by KeyboardEvent.code only (simulated German QWERTZ and US layouts, plus remapped
//   `key` values), the camera works while the game is paused;
// - mouse: middle-drag grabs the terrain (the grabbed point stays under the cursor), the wheel zooms
//   towards the cursor (the terrain point under it stays ≤ 1/16 WU), edge pan, Ctrl+middle-drag
//   rotates; the canvas context menu and middle-click autoscroll are suppressed;
// - fullscreen (Alt+Enter) and pointer confinement (pointer lock + virtual cursor) where the
//   headless engine supports them, otherwise skipped with the reason.

const ANCHOR_WU = 1 / 16;

async function cam(page: Page) {
  return page.evaluate(() => window.__faf!.camera());
}

/** Dispatches a synthetic key event on the window (layout simulation: code and key chosen freely). */
async function key(page: Page, type: 'keydown' | 'keyup', code: string, keyValue: string, mods: { ctrlKey?: boolean; altKey?: boolean } = {}): Promise<boolean> {
  return page.evaluate(
    ({ t, c, k, m }) => {
      const ev = new KeyboardEvent(t, { code: c, key: k, bubbles: true, cancelable: true, ...m });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    },
    { t: type, c: code, k: keyValue, m: mods },
  );
}

async function tap(page: Page, code: string, keyValue: string): Promise<void> {
  await key(page, 'keydown', code, keyValue);
  await key(page, 'keyup', code, keyValue);
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

for (const server of SERVERS) {
  test(`camera: Tastatur (WASD, H, Home), Hotkeys über code (DE/US), in Pause – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1024);
    await waitTick(page, 3);
    await page.locator('#game-canvas').focus();

    // The camera starts at the own start position, following the terrain (plateau ≈ 24 WU).
    const start = await cam(page);
    expect(dist(start, HOLLOW_RIDGE.own)).toBeLessThan(0.5);
    expect(start.y).toBeGreaterThan(20);
    expect(start.clearance).toBeGreaterThanOrEqual(2);

    // WASD (real key presses) and arrows.
    const moves: Record<string, number> = {};
    for (const k of ['KeyW', 'KeyD', 'KeyS', 'KeyA', 'ArrowUp', 'ArrowRight']) {
      const a = await cam(page);
      await page.keyboard.down(k);
      await page.waitForTimeout(350);
      await page.keyboard.up(k);
      await page.waitForTimeout(50);
      const b = await cam(page);
      moves[k] = dist(a, b);
      expect(moves[k], k).toBeGreaterThan(5);
    }

    // KeyH: jump to the own start (ACU stand-in until MS5).
    await page.evaluate(() => window.__faf!.setCamera(300, 200));
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(50);
    expect(dist(await cam(page), HOLLOW_RIDGE.own)).toBeLessThan(0.5);

    // Layout independence: only `code` counts, never `key`.
    // German QWERTZ: the physical H/P keys produce 'h'/'p' like US; KeyY/KeyZ are swapped ('z'/'y').
    await page.evaluate(() => window.__faf!.setCamera(300, 200));
    await tap(page, 'KeyH', 'h');
    expect(dist(await cam(page), HOLLOW_RIDGE.own), 'DE KeyH').toBeLessThan(0.5);
    // A remapped layout (key 'x' on the physical H key) still jumps; key 'h' on another code does not.
    await page.evaluate(() => window.__faf!.setCamera(300, 200));
    await tap(page, 'KeyX', 'h');
    expect(dist(await cam(page), { x: 300, z: 200 }), 'key "h" on code KeyX does nothing').toBeLessThan(0.5);
    await tap(page, 'KeyH', 'x');
    expect(dist(await cam(page), HOLLOW_RIDGE.own), 'code KeyH with key "x"').toBeLessThan(0.5);
    // DE QWERTZ: code KeyZ produces 'y', code KeyY produces 'z' – neither is bound; P pauses on both layouts.
    await tap(page, 'KeyZ', 'y');
    await tap(page, 'KeyY', 'z');
    expect(await page.evaluate(() => window.__faf!.paused)).toBe(false);
    // Console key: DE '^' (dead key) and US '`' are both code Backquote.
    await tap(page, 'Backquote', 'Dead');
    await expect(page.locator('[data-testid="console"]')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await tap(page, 'Backquote', '`');
    await expect(page.locator('[data-testid="console"]')).toBeHidden();
    await page.locator('#game-canvas').focus();
    // Pause with a remapped key value on code KeyP; key 'p' on another code does not pause.
    await tap(page, 'KeyO', 'p');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__faf!.paused)).toBe(false);
    await tap(page, 'KeyP', 'π');
    await page.waitForFunction(() => window.__faf!.paused === true);

    // Camera in pause: keys, wheel and H keep working, the tick stands still.
    const tick0 = await page.evaluate(() => window.__faf!.tick);
    const p0 = await cam(page);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(350);
    await page.keyboard.up('KeyD');
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(250);
    const p1 = await cam(page);
    expect(dist(p0, p1)).toBeGreaterThan(5);
    expect(p1.distance).toBeGreaterThan(p0.distance);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(50);
    expect(dist(await cam(page), HOLLOW_RIDGE.own)).toBeLessThan(0.5);
    expect(await page.evaluate(() => window.__faf!.tick)).toBe(tick0);
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__faf!.paused === false);

    const report = { browser: testInfo.project.name, server: server.name, start, moves, p0, p1 };
    writeReport(`camera-keys-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'camera-keys', report);
    expectNoErrors(errors);
  });

  test(`camera: Mittelklick-Grab, Zoom zum Cursor, Edge-Pan, Rotation, Kontextmenü – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1024);
    await waitTick(page, 3);
    await page.bringToFront();
    await page.evaluate(() => {
      const w = window as unknown as { __fafEv: Record<string, boolean[]> };
      w.__fafEv = { contextmenu: [], middledown: [], middlepointer: [] };
      window.addEventListener('contextmenu', (e) => w.__fafEv.contextmenu!.push(e.defaultPrevented));
      window.addEventListener('mousedown', (e) => {
        if (e.button === 1) w.__fafEv.middledown!.push(e.defaultPrevented);
      });
      window.addEventListener('pointerdown', (e) => {
        if (e.button === 1) w.__fafEv.middlepointer!.push(e.defaultPrevented);
      });
    });
    await page.evaluate((o) => window.__faf!.setCamera(o.x + 60, o.z + 60, 70), HOLLOW_RIDGE.own);
    await settle(page);

    // Middle-drag grab: the terrain point under the cursor follows it.
    const a = { x: 700, y: 420 };
    const b = { x: 560, y: 300 };
    const grabbed = await page.evaluate(({ x, y }) => window.__faf!.pickAt(x, y), a);
    expect(grabbed?.hit).toBe(true);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up({ button: 'middle' });
    await settle(page);
    const underB = await page.evaluate(({ x, y }) => window.__faf!.pickAt(x, y), b);
    const grabErr = Math.hypot(underB!.x - grabbed!.x, underB!.z - grabbed!.z);
    expect(grabErr, 'grabbed terrain point stays under the cursor').toBeLessThanOrEqual(0.1);

    // Wheel zoom towards the cursor: the terrain point under the cursor stays (≤ 1/16 WU).
    const c = { x: 820, y: 460 };
    await page.mouse.move(c.x, c.y);
    const zooms: { dir: string; before: number; after: number; err: number }[] = [];
    for (const [dy, dir] of [
      [-120, 'in'],
      [-120, 'in'],
      [240, 'out'],
      [-360, 'in'],
    ] as const) {
      const p = await page.evaluate(({ x, y }) => window.__faf!.pickAt(x, y), c);
      const d0 = (await cam(page)).distance;
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(250);
      await settle(page);
      const q = await page.evaluate(({ x, y }) => window.__faf!.pickAt(x, y), c);
      const d1 = (await cam(page)).distance;
      const err = Math.hypot(q!.x - p!.x, q!.z - p!.z, q!.y - p!.y);
      zooms.push({ dir, before: d0, after: d1, err });
      if (dir === 'in') expect(d1).toBeLessThan(d0);
      else expect(d1).toBeGreaterThan(d0);
      expect(err, `zoom ${dir}: point under the cursor moved`).toBeLessThanOrEqual(ANCHOR_WU);
    }

    // Edge pan: pointer in the 8 px band at the right edge.
    const focused = await page.evaluate(() => document.hasFocus());
    let edge: { moved: number; skipped: string | null };
    if (focused) {
      const e0 = await cam(page);
      await page.mouse.move(1276, 360, { steps: 4 });
      await page.waitForTimeout(500);
      const e1 = await cam(page);
      await page.mouse.move(640, 360, { steps: 4 });
      edge = { moved: dist(e0, e1), skipped: null };
      expect(edge.moved, 'edge pan').toBeGreaterThan(3);
    } else {
      const reason = 'document.hasFocus() false im headless Browser – Edge-Pan braucht ein fokussiertes Fenster';
      edge = { moved: 0, skipped: reason };
      testInfo.annotations.push({ type: 'skip-part', description: reason });
    }

    // Rotation: Ctrl + middle-drag changes the yaw; Home resets it.
    const y0 = (await cam(page)).yaw;
    await page.mouse.move(640, 360);
    await page.keyboard.down('Control');
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(740, 340, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    await page.keyboard.up('Control');
    const y1 = (await cam(page)).yaw;
    expect(Math.abs(y1 - y0), 'yaw changed').toBeGreaterThan(0.3);
    await page.locator('#game-canvas').focus();
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);
    expect(Math.abs((await cam(page)).yaw - y0)).toBeLessThan(1e-9);

    // Context menu and middle-click autoscroll are suppressed.
    await page.mouse.click(640, 360, { button: 'right' });
    const synthetic = await page.evaluate(() => {
      const cv = document.getElementById('game-canvas')!;
      const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
      cv.dispatchEvent(cm);
      const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
      cv.dispatchEvent(md);
      const ax = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
      cv.dispatchEvent(ax);
      return { contextmenu: cm.defaultPrevented, middleMousedown: md.defaultPrevented, auxclick: ax.defaultPrevented };
    });
    const ev = await page.evaluate(() => (window as unknown as { __fafEv: Record<string, boolean[]> }).__fafEv);
    expect(synthetic).toEqual({ contextmenu: true, middleMousedown: true, auxclick: true });
    expect(ev.contextmenu!.every((p) => p), 'real right click: contextmenu defaultPrevented').toBe(true);
    // Real middle presses: the pointerdown is prevented (so browsers fire no compatibility mousedown
    // that could start autoscroll); if a mousedown still arrives, it is prevented as well.
    expect(ev.middlepointer!.length).toBeGreaterThan(0);
    expect(ev.middlepointer!.every((p) => p), 'middle pointerdown defaultPrevented').toBe(true);
    expect(ev.middledown!.every((p) => p), 'middle mousedown defaultPrevented (no autoscroll)').toBe(true);

    const report = { browser: testInfo.project.name, server: server.name, grabbed, underB, grabErr, zooms, edge, yaw: { y0, y1 }, events: ev, synthetic };
    writeReport(`camera-mouse-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'camera-mouse', report);
    expectNoErrors(errors);
  });

  test(`camera: Vollbild (Alt+Enter) – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1024);
    const before = await page.evaluate(() => window.__faf!.fullscreen());
    test.skip(!before.supported, `Fullscreen API im headless ${testInfo.project.name} nicht vorhanden`);
    await page.locator('#game-canvas').focus();
    await page.keyboard.press('Alt+Enter');
    const entered = await page
      .waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!entered, `requestFullscreen wird im headless ${testInfo.project.name} nicht ausgeführt (keine Vollbild-Umgebung)`);
    const state = await page.evaluate(() => ({ el: document.fullscreenElement?.id ?? null, fs: window.__faf!.fullscreen() }));
    expect(state.el).toBe('game-root');
    expect(state.fs.active).toBe(true);
    // HUD stays visible in fullscreen (overlay is inside the root).
    await expect(page.locator('[data-testid="hud"]')).toBeVisible();
    await page.keyboard.press('Alt+Enter');
    await page.waitForFunction(() => document.fullscreenElement === null, null, { timeout: 3000 });
    writeReport(`camera-fullscreen-${testInfo.project.name}-${server.transport}`, { browser: testInfo.project.name, server: server.name, before, state });
    expectNoErrors(errors);
  });

  test(`camera: Pointer-Confinement im Vollbild (Pointer Lock + virtueller Cursor) – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1024);
    const before = await page.evaluate(() => window.__faf!.fullscreen());
    test.skip(!before.supported || !before.pointerLockSupported, `Fullscreen/Pointer-Lock-API im headless ${testInfo.project.name} nicht vorhanden`);
    await page.locator('#game-canvas').focus();
    await page.keyboard.press('Alt+Enter');
    const entered = await page
      .waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!entered, `requestFullscreen wird im headless ${testInfo.project.name} nicht ausgeführt`);
    // The first press in fullscreen (a user gesture) requests the lock.
    await page.mouse.click(640, 360);
    const locked = await page
      .waitForFunction(() => window.__faf!.fullscreen().locked, null, { timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    const afterClick = await page.evaluate(() => window.__faf!.fullscreen());
    expect(afterClick.lockRequests).toBeGreaterThanOrEqual(1);
    test.skip(!locked, `Pointer Lock wird im headless ${testInfo.project.name} nicht gewährt (requests ${afterClick.lockRequests}, errors ${afterClick.lockErrors})`);
    expect(afterClick.virtualCursor?.visible).toBe(true);
    const v0 = afterClick.virtualCursor!;
    await page.mouse.move(700, 400, { steps: 4 });
    const v1 = (await page.evaluate(() => window.__faf!.fullscreen())).virtualCursor!;
    expect(Math.hypot(v1.x - v0.x, v1.y - v0.y)).toBeGreaterThan(10);
    // Clamped to the viewport even when the mouse runs far out.
    await page.mouse.move(5000, 5000, { steps: 4 });
    const v2 = (await page.evaluate(() => window.__faf!.fullscreen())).virtualCursor!;
    expect(v2.x).toBeLessThanOrEqual(1279);
    expect(v2.y).toBeLessThanOrEqual(719);
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !window.__faf!.fullscreen().locked);
    writeReport(`camera-pointerlock-${testInfo.project.name}-${server.transport}`, { browser: testInfo.project.name, server: server.name, before, afterClick, v1, v2 });
    expectNoErrors(errors);
  });
}
