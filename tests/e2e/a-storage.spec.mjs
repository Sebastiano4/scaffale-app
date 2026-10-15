import { test, expect } from '@playwright/test';
import { freshApp } from './helpers.mjs';

test('library menu shows storage usage line', async ({ page }) => {
  await freshApp(page);
  await page.evaluate(() => {
    document.querySelectorAll('#library-menu').forEach((m) => (m.hidden = false));
  });
  await expect(page.locator('#storage-info')).toContainText(/Storage: .* MB/);
});
