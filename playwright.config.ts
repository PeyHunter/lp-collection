import { defineConfig, devices } from "@playwright/test";

// Set E2E_PORT to a unique value when several checkouts run browser tests at once.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    // iPhone screen size and touch; Chromium stands in for Safari so it runs without system packages.
    { name: "iphone", use: { ...devices["iPhone 15"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: "npm run build && node e2e/serve.ts",
    url: `http://localhost:${port}/api/health`,
    env: { PORT: String(port) },
    // Never reuse: a server already on this port may be another checkout running other code.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
