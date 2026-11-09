import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CartPage, HomePage, LoginPage, ProductPage, SearchResultsPage } from '../pages/index.js';

/**
 * Playwright fixtures: every test (hand-written or AI-generated) receives ready
 * page objects and the shared test data, instead of building them itself.
 */
const dataFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-data/demowebshop.json');
export const testData = JSON.parse(readFileSync(dataFile, 'utf8')) as typeof import('../../test-data/demowebshop.json');

interface ShopFixtures {
  homePage: HomePage;
  searchPage: SearchResultsPage;
  loginPage: LoginPage;
  productPage: ProductPage;
  cartPage: CartPage;
  data: typeof testData;
  failureContext: void;
}

export const test = base.extend<ShopFixtures>({
  /**
   * Auto fixture: when a test fails, record the page URL as an annotation.
   * The Execution Agent reads it from the JSON report and the Healing Agent
   * re-opens that page to search for a replacement locator.
   */
  failureContext: [
    async ({ page }, use, testInfo) => {
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        testInfo.annotations.push({ type: 'page-url', description: page.url() });
      }
    },
    { auto: true }
  ],
  homePage: async ({ page }, use) => use(new HomePage(page)),
  searchPage: async ({ page }, use) => use(new SearchResultsPage(page)),
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  productPage: async ({ page }, use) => use(new ProductPage(page)),
  cartPage: async ({ page }, use) => use(new CartPage(page)),
  // eslint-disable-next-line no-empty-pattern
  data: async ({}, use) => use(testData)
});

export { expect };
