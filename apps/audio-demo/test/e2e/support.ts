import { test as base } from '@playwright/test';
import { installSilentOutput } from '../support/silent-output.ts';

export { expect } from '@playwright/test';
export const test = base.extend({
  page: async ({ page }, use) => {
    await installSilentOutput(page);
    await use(page);
  },
});
