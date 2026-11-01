import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL;
if (!baseURL) {
  throw new Error('BASE_URL is required, e.g. BASE_URL=http://localhost:8081 npx playwright test');
}

export default defineConfig({
  testDir: './tests',
  // Flaky tests must be fixed, never hidden behind retries.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL },
  projects: [
    { name: 'api', testMatch: /.*\.api\.spec\.ts/ },
    { name: 'ui', testMatch: /.*\.ui\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
});
