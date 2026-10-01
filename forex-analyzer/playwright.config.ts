import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 5199;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

/**
 * End-to-end test of the main flow against a real dev server in mock mode
 * (mock market data, mock analyst, throwaway database). Needs a Chromium:
 * run `npx playwright install chromium` once, or point
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE at an existing one.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 1000 },
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: "npm run dev",
    url: `http://127.0.0.1:${PORT}/api/status`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      HOST: "127.0.0.1",
      DATABASE_PATH: join(tmpdir(), `fx-analyzer-e2e-${Date.now()}.db`),
      MARKET_DATA_PROVIDER: "mock",
      ANTHROPIC_API_KEY: "",
    },
  },
});
