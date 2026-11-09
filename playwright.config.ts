import { defineConfig, devices } from '@playwright/test';
import { env } from './src/config/env.js';

/**
 * Projects:
 *  ui        — curated, human-reviewed UI tests       (tests/ui)
 *  api       — curated API tests via APIRequest       (tests/api)
 *  framework — unit tests of the agents themselves    (tests/framework, no browser/network)
 *  generated — AI-generated tests                     (generated-tests, run by the Execution Agent)
 *
 * Workers are capped at 2: the target is a shared public demo, keep the load low.
 */
export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-html', open: 'never' }],
    ['json', { outputFile: 'reports/playwright-results.json' }],
    ['junit', { outputFile: 'reports/junit.xml' }]
  ],
  use: {
    baseURL: env.APP_BASE_URL,
    headless: env.HEADLESS,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  projects: [
    { name: 'ui', testDir: './tests/ui', use: { ...devices['Desktop Chrome'] } },
    { name: 'api', testDir: './tests/api' },
    { name: 'framework', testDir: './tests/framework' },
    { name: 'generated', testDir: './generated-tests', use: { ...devices['Desktop Chrome'] } }
  ]
});
