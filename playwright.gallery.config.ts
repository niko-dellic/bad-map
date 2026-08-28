import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "readme-gallery.capture.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: "http://127.0.0.1:5176",
    browserName: "chromium",
    channel: "chrome",
    viewport: { width: 1200, height: 750 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  },
  webServer: {
    command: "npm run dev -- --port 5176",
    url: "http://127.0.0.1:5176",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  reporter: [["list"]],
});
