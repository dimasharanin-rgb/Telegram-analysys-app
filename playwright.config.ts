import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Must match e2e/global-setup.ts, which starts the mock provider on it. */
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 3199);

/**
 * Point at a Chromium that is already on the machine, for environments that
 * ship one instead of letting Playwright download a matching build. Left unset,
 * Playwright uses its own browser as usual.
 *
 * Needed where the image's browsers are older than the installed Playwright:
 * it asks for a `chrome-headless-shell` build that is not there, and the full
 * Chromium beside it works fine. On this container:
 *
 *   PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

/**
 * A throwaway database per run, so one run's analyses and credits never leak
 * into the next and a failed run leaves nothing behind in the project.
 */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "analyzer-e2e-"));

/**
 * End-to-end tests run against a real production build.
 *
 * The provider is the one thing that is faked, and it is faked at the network
 * boundary: ANTHROPIC_BASE_URL points at a local server that answers with JSON
 * satisfying the schema the request asked for. Everything else is real — the
 * SQLite database, the owner cookie, both gates, the module loop, evidence
 * validation, excerpt pruning, the PDF renderer and the simulated payment
 * provider's signed-event path.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      // A key has to be present for the client to be constructed; the request
      // goes to the local mock, so it is never used against the real API.
      ANTHROPIC_API_KEY: "sk-ant-e2e-placeholder",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      ANTHROPIC_MAX_RETRIES: "0",
      APP_SECRET: "e2e-app-secret-not-used-anywhere-else",
      APP_URL: BASE_URL,
      DATABASE_PATH: path.join(dataDir, "e2e.db"),
      // Enough headroom that the free-tier tests never hit the ceiling.
      FREE_ANALYSES_PER_OWNER: "25",
      RATE_LIMIT_MAX_REQUESTS: "400",
    },
  },
});
