import path from "node:path";
import fs from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

const FIXTURE = path.join(process.cwd(), "fixtures", "telegram-sample.json");

/* -------------------------------------------------------------------------
 * A canned analysis, wired to real message ids from the outgoing request.
 * ---------------------------------------------------------------------- */

interface OutgoingRequest {
  consent: { accepted: boolean; scope: string };
  participants: { id: string; label: string }[];
  excerpts: { messages: { id: string; p: string; t: string }[] }[];
  statistics: { totalMessages: number };
}

function analysisFor(ids: string[]) {
  return {
    overview: {
      summary:
        "Participant A opens most conversations and writes at greater length; Participant B replies quickly and briefly. One disagreement is followed by a direct repair.",
      confidence: "medium",
    },
    patterns: [
      {
        title: "Follow-up messages after a short reply",
        category: "conversation-dynamics",
        observation:
          "Participant A frequently sends another message shortly after a one-word reply from Participant B.",
        interpretation:
          "One reading is that a brief reply reads as unfinished to Participant A.",
        uncertainty:
          "The messages alone cannot establish what either person intended by the brevity.",
        evidence: [{ messageIds: ids.slice(0, 2), excerpt: "A short reply, then a follow-up." }],
        confidence: "medium",
      },
      {
        title: "Evening is when this conversation happens",
        category: "communication",
        observation: "Most exchanges begin after 18:00 in the export's own timezone.",
        interpretation: "One reading is that contact is shaped around work hours.",
        uncertainty: "Timing reflects availability, not priority.",
        evidence: [],
        confidence: "high",
      },
    ],
    strengths: [
      {
        title: "Repair happens directly",
        description:
          "After the disagreement, both name their own part in it rather than relitigating the subject.",
        evidence: [{ messageIds: ids.slice(0, 1), excerpt: "An apology naming the specific thing said." }],
      },
    ],
    watchouts: [
      {
        title: "Decisions arrive with a deadline attached",
        description:
          "Several decisions are raised alongside an external time limit, which changes the shape of the conversation.",
        evidence: [],
      },
    ],
    suggestions: [
      {
        title: "Separate the decision from the deadline",
        description: "Raising the two together makes a reply feel like a verdict.",
        do: "Say what you would like, and mention timing in a separate message.",
        avoid: "Opening with the date someone else set.",
      },
    ],
    recurringTopics: [
      {
        topic: "A possible move",
        description: "A flat comes up repeatedly across the whole period.",
        frequency: "most months",
      },
    ],
  };
}

function sseBody(ids: string[]): string {
  const frames = [
    { type: "progress", data: { stage: "preparing", message: "Reading conversation…", percent: 5 } },
    {
      type: "progress",
      data: {
        stage: "analyzing",
        message: "Analyzing communication patterns…",
        percent: 25,
        step: 1,
        totalSteps: 1,
      },
    },
    { type: "progress", data: { stage: "validating", message: "Checking the analysis…", percent: 90 } },
    {
      type: "result",
      data: {
        analysis: analysisFor(ids),
        strategy: "single-pass",
        chunks: 1,
        provider: "anthropic",
        model: "claude-opus-5",
      },
    },
  ];
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

/** Captures what the browser tried to send, then answers with a canned stream. */
async function stubAnalyze(page: Page): Promise<() => OutgoingRequest | null> {
  let captured: OutgoingRequest | null = null;

  await page.route("**/api/analyze", async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as OutgoingRequest;
    captured = body;
    const ids = body.excerpts.flatMap((excerpt) => excerpt.messages.map((m) => m.id));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: sseBody(ids),
    });
  });

  return () => captured;
}

async function importFixture(page: Page): Promise<void> {
  await page.goto("/analyze");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole("heading", { name: "Sam Okonkwo" })).toBeVisible();
}

async function runAnalysis(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Continue to analysis" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const start = dialog.getByRole("button", { name: "Start analysis" });
  await expect(start).toBeDisabled();
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByRole("checkbox").nth(1).check();
  await expect(start).toBeEnabled();
  await start.click();
}

/* -------------------------------------------------------------------------
 * Tests
 * ---------------------------------------------------------------------- */

test("landing page leads into the flow", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Understand your conversations." }),
  ).toBeVisible();
  await expect(page.getByText("The MVP supports text-only Telegram exports.")).toBeVisible();

  await page.getByRole("link", { name: "Analyze a conversation" }).first().click();
  await expect(page.getByRole("heading", { name: "Import a conversation" })).toBeVisible();
});

test("import computes statistics in the browser", async ({ page }) => {
  await importFixture(page);

  // Parsed participants and a date range, from the file alone.
  await expect(page.getByText("Alex Moreau")).toBeVisible();
  await expect(page.getByText("9 Jan 2024 – 8 Aug 2024")).toBeVisible();
  await expect(page.getByText("1,573")).toBeVisible();

  // Nothing has been sent yet at this point.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("changing the conversation gap changes the statistics", async ({ page }) => {
  await importFixture(page);

  const conversationsTile = page.locator("dl > div", { hasText: "Conversations" });
  const before = await conversationsTile.locator("dd").innerText();

  await page.getByRole("radio", { name: /1 hour/ }).click();
  await expect(conversationsTile.locator("dd")).not.toHaveText(before);
});

test("consent gates the request and the request carries no real names", async ({ page }) => {
  const captured = await stubAnalyze(page);
  await importFixture(page);
  await runAnalysis(page);

  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();

  const request = captured();
  expect(request).not.toBeNull();
  expect(request!.consent.accepted).toBe(true);
  expect(request!.consent.scope).toBe("text-only");
  expect(request!.participants.map((p) => p.label)).toEqual([
    "Participant A",
    "Participant B",
  ]);

  const serialised = JSON.stringify(request);
  expect(serialised).not.toContain("Alex Moreau");
  expect(serialised).not.toContain("Sam Okonkwo");
});

test("insights are browsable as cards with evidence", async ({ page }) => {
  await stubAnalyze(page);
  await importFixture(page);
  await runAnalysis(page);

  const carousel = page.getByRole("region", { name: "Analysis insights" });
  await expect(carousel).toBeVisible();

  // The first card is the overview, with real names substituted back in.
  await expect(carousel.getByText(/Alex Moreau|Sam Okonkwo/).first()).toBeVisible();
  const position = page.getByText(/^\d+ \/ \d+$/);
  await expect(position).toHaveText(/^1 \/ \d+$/);

  // Next moves through the deck; the measured card carries a big number.
  await page.getByRole("button", { name: "Next insight" }).click();
  await expect(position).toHaveText(/^2 \/ \d+$/);
  await expect(carousel.getByText("Measured")).toBeVisible();

  // Keyboard navigation works too.
  await carousel.focus();
  await page.keyboard.press("ArrowRight");
  await expect(position).toHaveText(/^3 \/ \d+$/);
  await page.keyboard.press("ArrowLeft");
  await expect(position).toHaveText(/^2 \/ \d+$/);

  // Walk to an AI pattern and open its evidence.
  const evidenceToggle = page.getByRole("button", { name: /Show evidence/ });
  for (let i = 0; i < 10 && (await evidenceToggle.count()) === 0; i += 1) {
    await page.getByRole("button", { name: "Next insight" }).click();
  }
  await expect(evidenceToggle).toBeVisible();
  await evidenceToggle.click();
  await expect(
    page.getByText("These are conversation excerpts the analysis referred to."),
  ).toBeVisible();
  // Evidence is rendered from the local messages, so a real sender name shows
  // inside the card itself.
  await expect(carousel.getByText(/Alex Moreau|Sam Okonkwo/).first()).toBeVisible();
});

test("stats tab shows the local numbers and exports a real PDF", async ({ page }) => {
  await stubAnalyze(page);
  await importFixture(page);
  await runAnalysis(page);

  await page.getByRole("button", { name: "Stats" }).click();
  await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
  await expect(page.getByText("Who talks more?")).toBeVisible();
  await expect(page.getByText("Who starts conversations?")).toBeVisible();
  await expect(page.getByText("Most used words")).toBeVisible();

  // The PDF route is not stubbed - this really renders on the server.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^conversation-analysis-.*\.pdf$/);

  const saved = await download.path();
  const bytes = fs.readFileSync(saved);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.byteLength).toBeGreaterThan(10_000);
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
