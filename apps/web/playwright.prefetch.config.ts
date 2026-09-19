import { defineConfig, devices } from "@playwright/test";

// Prefetch is disabled by Next in development. Run after the production build.
export default defineConfig({
  testDir: "./tests/prefetch",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    hasTouch: true,
    baseURL: "http://127.0.0.1:3108",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3108",
    url: "http://127.0.0.1:3108",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
