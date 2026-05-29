import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

// The dev-login route is gated by DEV_LOGIN_SECRET. Next loads it into the dev
// server from .env.local automatically; the test process needs it too, so read
// it straight from .env.local (no dotenv dependency).
function readEnv(key: string): string | undefined {
  try {
    const txt = fs.readFileSync(".env.local", "utf8");
    return txt.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
  } catch {
    return undefined;
  }
}
process.env.DEV_LOGIN_SECRET ??= readEnv("DEV_LOGIN_SECRET");

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Next 16 allows only one dev server per project, so reuse whatever is on
  // :3000. Next watches .env.local, so DEV_LOGIN_SECRET is picked up live.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
