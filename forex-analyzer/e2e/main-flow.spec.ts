import { expect, test, type Page } from "@playwright/test";

/** The e2e server has no Twelve Data key, so the flow below runs in MOCK mode; LIVE must say it is unavailable. */

async function useMockData(page: Page) {
  await page.goto("/analyze");
  const mock = page.getByRole("radio", { name: "MOCK" });
  if ((await mock.getAttribute("aria-checked")) !== "true") await mock.click();
  await expect(page.getByText("MOCK DATA", { exact: true })).toBeVisible();
}

async function enterTrade(page: Page, opts: { positionSize?: string } = {}) {
  await page.goto("/analyze");
  await page.getByLabel("Pair").selectOption("EUR/USD");
  await page.getByRole("radio", { name: "LONG" }).click();
  await page.getByRole("radio", { name: "MARKET" }).click();
  await expect(page.locator("#entry")).not.toHaveValue("");
  const entry = Number(await page.locator("#entry").inputValue());
  await page.locator("#stopLoss").fill((entry - 0.002).toFixed(5));
  await page.locator("#takeProfit").fill((entry + 0.0045).toFixed(5));
  await page.locator("#positionSize").fill(opts.positionSize ?? "");
  return entry;
}

test("LIVE mode without a Twelve Data key says so and shows no substitute data", async ({ page }) => {
  await page.goto("/analyze");
  const live = page.getByRole("radio", { name: "LIVE" });
  if ((await live.getAttribute("aria-checked")) !== "true") await live.click();
  await expect(page.getByText("LIVE DATA UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(page.getByTestId("feed-state")).toHaveText("OFFLINE");
  await expect(page.getByText(/LIVE DATA UNAVAILABLE: TWELVE_DATA_API_KEY is not set/).first()).toBeVisible();
});

test("live price, candles, chart and data timestamp (mock source)", async ({ page }) => {
  await useMockData(page);
  await page.getByLabel("Pair").selectOption("EUR/USD");
  await expect(page.getByTestId("feed-state")).toHaveText("SIMULATED");
  await expect(page.getByTestId("data-age")).toHaveText(/Data: \d+ seconds? ago/);
  for (const tf of ["M5", "M15", "H1", "H4"]) await page.getByRole("tab", { name: tf }).click();
  await expect(page.getByTestId("chart-live")).toHaveText("SIMULATED");
});

test("configure account → enter trade → calculate risk → validate rules → display result → journal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await useMockData(page);

  await page.goto("/settings");
  await page.locator("#accountSize").fill("10000");
  await page.locator("#maxRiskPerTradePct").fill("0.5");
  await page.locator("#minRiskReward").fill("2");
  await page.locator("#accountStateSource").selectOption("JOURNAL");
  await page.getByRole("checkbox", { name: /London/ }).uncheck();
  await page.getByRole("checkbox", { name: /New York/ }).uncheck(); // no session restriction: the test must not depend on the clock
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  await enterTrade(page);
  await expect(page.getByText(/Suggested position size/)).toBeVisible();
  await expect(page.getByText("Risk within limit")).toBeVisible();

  await page.getByRole("button", { name: "ANALYZE TRADE" }).click();
  const card = page.locator("section[aria-live]");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/^(ACCEPTABLE|CAUTION|REJECT)$/)).toBeVisible();
  await expect(card.getByText(/not a probability of profit/)).toBeVisible();

  await page.getByRole("radio", { name: "CUSTOM" }).click();
  await page.locator("#positionSize").fill("1.00");
  await expect(page.getByText(/TRADE BLOCKED — it breaks a hard rule/)).toBeVisible();
  await page.getByRole("button", { name: "ANALYZE TRADE" }).click();
  await expect(card.getByText("TRADE BLOCKED")).toBeVisible();

  await page.goto("/journal");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.locator("tbody tr").nth(1).click();
  await page.locator("#outcome").selectOption("WIN");
  await page.locator("#pnl").fill("112.50");
  await page.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/");
  await expect(page.getByText("$10,112.50").first()).toBeVisible();
  expect(errors).toEqual([]);
});
