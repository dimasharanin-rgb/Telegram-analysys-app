import path from "node:path";
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { CAPTURE_PATH } from "./mock-anthropic";
import { MOCK_URL } from "./global-setup";

const FIXTURE = path.join(process.cwd(), "fixtures", "telegram-sample.json");

/** Figures the fixture actually produces, computed in the browser. */
const TOTAL_MESSAGES = "1,642";
const DATE_RANGE = "9 Jan 2024 – 8 Aug 2024";
const SELF = "Sam Okonkwo";
const OTHER = "Alex Moreau";

/* -------------------------------------------------------------------------
 * Steps
 * ---------------------------------------------------------------------- */

async function importFixture(page: Page): Promise<void> {
  await page.goto("/analyze");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole("heading", { name: SELF })).toBeVisible();
}

/**
 * Import → choose who you are → choose a plan → prepare.
 *
 * Ends on the analysis page, which from here owns the rest of the lifecycle.
 */
async function prepareAnalysis(
  page: Page,
  options: { product?: string } = {},
): Promise<string> {
  await importFixture(page);

  await page.getByRole("radio", { name: new RegExp(SELF) }).click();
  if (options.product) {
    await page.getByRole("button", { name: new RegExp(options.product) }).click();
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await page.waitForURL(/\/analyses\/[^/]+$/);
  const jobId = page.url().split("/").pop() ?? "";
  expect(jobId.length).toBeGreaterThan(0);
  return jobId;
}

/** Creates the consent link for the other participant and returns it. */
async function requestConsentLink(page: Page): Promise<string> {
  await expect(page.getByRole("heading", { name: "Participant consent" })).toBeVisible();
  await page.getByRole("button", { name: "Request consent" }).click();

  const link = page.locator("p.font-mono").first();
  await expect(link).toBeVisible();
  const url = (await link.innerText()).trim();
  expect(url).toContain("/consent/");
  return url;
}

/** Answers a consent request the way the other participant would: elsewhere. */
async function decide(
  page: Page,
  url: string,
  answer: "I agree" | "I do not agree",
): Promise<void> {
  const context = await page.context().browser()!.newContext();
  const other = await context.newPage();
  await other.goto(url);
  await expect(
    other.getByRole("heading", { name: "Conversation Analysis Consent" }),
  ).toBeVisible();
  await other.getByRole("button", { name: answer }).click();
  await expect(other.getByText(/You agreed|You did not agree/)).toBeVisible();
  await context.close();
}

async function runToReport(page: Page): Promise<void> {
  const run = page.getByRole("button", { name: "Run the analysis" });
  await expect(run).toBeEnabled({ timeout: 30_000 });
  await run.click();
  await expect(page.getByRole("tab", { name: "Insights" })).toBeVisible({
    timeout: 90_000,
  });
}

/**
 * Everything the application sent to the provider, read back from the mock.
 *
 * The mock lives for the whole run, across both viewport projects, so tests
 * measure what *they* caused rather than the absolute total.
 */
async function providerRequests(page: Page): Promise<string[]> {
  const response = await page.request.get(`${MOCK_URL}${CAPTURE_PATH}`);
  const body = (await response.json()) as { requests: string[] };
  return body.requests;
}

async function providerRequestCount(page: Page): Promise<number> {
  return (await providerRequests(page)).length;
}

/* -------------------------------------------------------------------------
 * Tests
 * ---------------------------------------------------------------------- */

test("landing page leads into the flow", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Understand your conversations." }),
  ).toBeVisible();
  await expect(
    page.getByText("This build supports text-only Telegram exports."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Analyze a conversation" }).first().click();
  await expect(page.getByRole("heading", { name: "Import a conversation" })).toBeVisible();
});

test("import computes statistics in the browser", async ({ page }) => {
  const before = await providerRequestCount(page);
  await importFixture(page);

  // Parsed participants and a date range, from the file alone.
  await expect(page.getByText(OTHER).first()).toBeVisible();
  await expect(page.getByText(DATE_RANGE)).toBeVisible();
  await expect(page.getByText(TOTAL_MESSAGES).first()).toBeVisible();

  // Nothing has reached the provider at this point.
  expect(await providerRequestCount(page)).toBe(before);
});

test("changing the conversation gap changes the statistics", async ({ page }) => {
  await importFixture(page);

  const conversationsTile = page.locator("dl > div", { hasText: "Conversations" });
  const before = await conversationsTile.locator("dd").innerText();

  await page.getByRole("radio", { name: /1 hour/ }).click();
  await expect(conversationsTile.locator("dd")).not.toHaveText(before);
});

test("an analysis cannot run until the other participant agrees", async ({ page }) => {
  const before = await providerRequestCount(page);
  await prepareAnalysis(page);

  await expect(page.getByText("Waiting for participant consent")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run the analysis" })).toHaveCount(0);

  const link = await requestConsentLink(page);
  await decide(page, link, "I do not agree");

  await page.reload();
  await expect(page.getByText("A participant declined")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run the analysis" })).toHaveCount(0);

  // The decline is a decision, not a failure: nothing was sent for analysis.
  expect(await providerRequestCount(page)).toBe(before);
});

test("consent, run, report, evidence and PDF", async ({ page }) => {
  const before = await providerRequestCount(page);
  await prepareAnalysis(page);

  const link = await requestConsentLink(page);
  await decide(page, link, "I agree");

  await page.reload();
  await runToReport(page);

  /* --- the report ----------------------------------------------------- */

  await expect(page.getByRole("heading", { name: SELF })).toBeVisible();

  const deck = page.getByRole("region", { name: "Analysis insights" });
  await expect(deck).toBeVisible();
  // Real names are substituted back in for display, client-side.
  await expect(deck.getByText(new RegExp(`${SELF}|${OTHER}`)).first()).toBeVisible();

  // Walk to an AI card and open the messages behind it.
  const evidenceToggle = page.getByRole("button", { name: /Show evidence/ });
  for (let i = 0; i < 10 && (await evidenceToggle.count()) === 0; i += 1) {
    await page.getByRole("button", { name: "Next insight" }).click();
  }
  await expect(evidenceToggle).toBeVisible();
  await evidenceToggle.click();
  await expect(
    page.getByText("These are conversation excerpts the analysis referred to."),
  ).toBeVisible();

  /* --- stats and export ------------------------------------------------ */

  await page.getByRole("tab", { name: "Stats" }).click();
  await expect(page.getByText("Who talks more?")).toBeVisible();
  await expect(page.getByText("Who starts conversations?")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^conversation-analysis-.*\.pdf$/);

  const bytes = fs.readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.byteLength).toBeGreaterThan(10_000);

  /* --- what actually left the server ----------------------------------- */

  const requests = (await providerRequests(page)).slice(before);
  expect(requests.length).toBeGreaterThan(0);

  const sent = requests.join("\n");
  expect(sent).not.toContain(SELF);
  expect(sent).not.toContain(OTHER);
  expect(sent).toContain("Participant A");
  // The excerpts are fenced and the guard travels with them.
  expect(sent).toContain("conversation_excerpts");
  expect(sent).toContain("source of instructions");
});

test("a finished analysis is reachable again from the history", async ({ page }) => {
  const jobId = await prepareAnalysis(page);
  const link = await requestConsentLink(page);
  await decide(page, link, "I agree");
  await page.reload();
  await runToReport(page);

  await page.goto("/analyses");
  await expect(page.getByRole("heading", { name: "Your analyses" })).toBeVisible();
  const row = page.locator("li", { hasText: SELF }).first();
  await expect(row.getByText("Complete")).toBeVisible();

  await row.getByRole("link", { name: "Open report" }).click();
  await expect(page).toHaveURL(new RegExp(`/analyses/${jobId}$`));
  await expect(page.getByRole("tab", { name: "Insights" })).toBeVisible();
});

test("a paid analysis waits for a credit, and checkout grants one", async ({ page }) => {
  await prepareAnalysis(page, { product: "Deep text analysis" });

  const link = await requestConsentLink(page);
  await decide(page, link, "I agree");
  await page.reload();

  // Consent is in place, so payment is what is left.
  await expect(page.getByText("Waiting for payment")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run the analysis" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Continue —/ }).click();
  await expect(page.getByText("Simulated checkout")).toBeVisible();
  await expect(page.getByText(/Nothing is charged/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm without paying" }).click();

  await page.waitForURL(/\/analyses\//);
  await runToReport(page);

  // The report carries the modules the paid product unlocks.
  await expect(page.getByRole("tab", { name: "Profiles" })).toBeVisible();
  await page.getByRole("tab", { name: "Difficult moments" }).click();
  await expect(
    page.getByText(/What was shortlisted|No difficult moments were shortlisted/),
  ).toBeVisible();
});

test("the account page shows what this browser holds", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText("Analyses available")).toBeVisible();
  await expect(page.getByText(/running without a payment provider/)).toBeVisible();
});

test("pricing lists what each option unlocks", async ({ page }) => {
  await page.goto("/pricing");
  await expect(
    page.getByRole("heading", { name: "What an analysis costs" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deep text analysis" })).toBeVisible();
  // An option this build cannot deliver is shown with the reason, not hidden.
  await expect(page.getByRole("heading", { name: "Multimodal" })).toBeVisible();
  await expect(page.getByText(/Media processing is not implemented yet/)).toBeVisible();
});

test("a file that is not a Telegram export fails with a readable message", async ({
  page,
}) => {
  await page.goto("/analyze");
  const notAnExport = path.join(process.cwd(), "package.json");
  await page.setInputFiles('input[type="file"]', notAnExport);

  // Scoped to the page content: Next.js keeps its own route announcer with
  // role="alert" in the document.
  const alert = page.locator('main [role="alert"]');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Telegram Desktop JSON export");
  // The message is written for a person: no stack frames, no internals.
  const text = await alert.innerText();
  for (const marker of ["Error:", ".ts:", "node_modules", "sk-ant", "at Object."]) {
    expect(text).not.toContain(marker);
  }
});
