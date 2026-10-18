import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const output = fileURLToPath(new URL('../../outputs/recovery/cloud/', import.meta.url));
// Requires an operator-started localhost gateway to the isolated private app.
export default defineConfig({
  testDir: '.', testMatch: 'restored-browser.spec.mjs', workers: 1, retries: 0,
  timeout: 180000, expect: { timeout: 30000 },
  reporter: [['list'], ['json', { outputFile: `${output}/results.json` }]],
  outputDir: `${output}/artifacts`,
  use: { actionTimeout: 30000, baseURL: 'http://127.0.0.1:8795', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
});
