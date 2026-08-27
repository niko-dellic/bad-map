import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/compatibility",
  testMatch: "compatibility.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:5177",
    browserName: "chromium",
    channel: "chrome",
    viewport: { width: 640, height: 480 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  },
  webServer: {
    command:
      "vite --config vite.compatibility.config.ts --host 127.0.0.1 --port 5177",
    url: "http://127.0.0.1:5177",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  reporter: [["list"]],
});
