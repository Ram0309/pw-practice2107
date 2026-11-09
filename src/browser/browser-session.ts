import { chromium, type Browser, type Page } from '@playwright/test';
import { env } from '../config/env.js';

/**
 * Short-lived browser session for agents (UI Analysis, Healing).
 * Always closes the browser, even on error.
 */
export async function withPage<T>(pathOrUrl: string, action: (page: Page) => Promise<T>): Promise<T> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: env.HEADLESS });
    const context = await browser.newContext({ baseURL: env.APP_BASE_URL });
    const page = await context.newPage();
    // The shared demo occasionally serves an empty document; wait for real content, retry once.
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.goto(pathOrUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      const ready = await page
        .waitForFunction(() => document.title.length > 0 && document.querySelectorAll('a[href]').length > 5, null, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (ready) break;
      if (attempt === 2) throw new Error(`Page ${pathOrUrl} did not render content (title/links missing)`);
    }
    return await action(page);
  } finally {
    await browser?.close();
  }
}
