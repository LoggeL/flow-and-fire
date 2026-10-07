import { test as base } from '@playwright/test';
import { installSilentOutput } from '../../../apps/game/test/support/silent-output.ts';
export * from '@playwright/test';
/** Every Game page fixture starts with a hardware-output guard before any navigation. */
export const test = base.extend({
  page: async ({ page }, use) => { await installSilentOutput(page); await use(page); },
});
