import { expect, test, type Page } from "@playwright/test";

async function enterTrade(page: Page, opts: { positionSize?: string } = {}) {
  await page.goto("/analyze");
  await page.locator("#pair").selectOption("EURUSD");
  await page.getByRole("radio", { name: "LONG" }).click();
  await page.getByRole("button", { name: "Market", exact: true }).click();
  await expect(page.locator("#entry")).not.toHaveValue("");
  const entry = Number(await page.locator("#entry").inputValue());
  await page.locator("#stopLoss").fill((entry - 0.002).toFixed(5));
  await page.locator("#takeProfit").fill((entry + 0.0045).toFixed(5));
  await page.locator("#positionSize").fill(opts.positionSize ?? "");
  return entry;
}

test("configure account → enter trade → calculate risk → validate rules → display result → journal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Configure the account
  await page.goto("/settings");
  await page.locator("#accountSize").fill("10000");
  await page.locator("#maxRiskPerTradePct").fill("0.5");
  await page.locator("#minRiskReward").fill("2");
  await page.getByRole("checkbox", { name: /London/ }).uncheck();
  await page.getByRole("checkbox", { name: /New York/ }).uncheck(); // no session restriction, so the test does not depend on the clock
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  // Enter a trade: the risk engine responds before any analysis
  await enterTrade(page);
  await expect(page.getByText("Suggested position size")).toBeVisible();
  await expect(page.getByText("0.25 lots").first()).toBeVisible();
  await expect(page.getByText("Risk within limit")).toBeVisible();

  // Analyze and display the structured result
  await page.getByRole("button", { name: "ANALYZE TRADE" }).click();
  const card = page.locator("section[aria-live]");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText(/^(ACCEPTABLE|CAUTION|REJECT)$/)).toBeVisible();
  await expect(card.getByText("Setup quality")).toBeVisible();
  await expect(card.getByText(/not a probability of profit/)).toBeVisible();
  await expect(page.getByText("Invalidation")).toBeVisible();
  await expect(page.getByRole("tab", { name: "M15" })).toBeVisible();

  // An oversized position is blocked by the account rules and never analysed
  await page.locator("#positionSize").fill("1.00");
  await expect(page.getByText(/TRADE BLOCKED — it breaks a hard rule/)).toBeVisible();
  await page.getByRole("button", { name: "ANALYZE TRADE" }).click();
  await expect(card.getByText("TRADE BLOCKED")).toBeVisible();
  await expect(card.getByText("Claude was not consulted", { exact: false })).toBeVisible();

  // Both analyses are in the journal; record an outcome for the first
  await page.goto("/journal");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.locator("tbody tr").nth(1).click();
  await page.locator("#outcome").selectOption("WIN");
  await page.locator("#pnl").fill("112.50");
  await page.getByRole("button", { name: "Save outcome" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.keyboard.press("Escape");

  // The dashboard reflects the recorded outcome
  await page.goto("/");
  await expect(page.getByText("$10,112.50").first()).toBeVisible();
  await expect(page.getByText(/Not enough data yet/)).toBeVisible();

  expect(errors).toEqual([]);
});

test("invalid stop loss is explained and blocked", async ({ page }) => {
  const entry = await enterTrade(page);
  await page.locator("#stopLoss").fill((entry + 0.001).toFixed(5));
  await expect(page.getByText(/stop loss must be below entry/)).toBeVisible();
  await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();
});
