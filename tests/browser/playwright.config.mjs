import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  testDir: '.', testMatch: ['learning.spec.mjs', 'recovery.spec.mjs'], workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: path.join(root, 'outputs/browser/results.json') }]],
  outputDir: path.join(root, 'outputs/browser/artifacts'),
  use: { actionTimeout: 10_000, baseURL: 'http://127.0.0.1:8799', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    command: 'node node_modules/wrangler/bin/wrangler.js dev --local --config "$M2_TEST_CONFIG" --persist-to "$M2_TEST_STATE" --ip 127.0.0.1 --port 8799 --inspector-port 0',
    url: 'http://127.0.0.1:8799/api/auth/me', reuseExistingServer: false, timeout: 60_000,
  },
});
