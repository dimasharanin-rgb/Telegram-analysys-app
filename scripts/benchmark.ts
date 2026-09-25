/**
 * Compares routing strategies before any of them is locked in.
 *
 *   npm run bench              cost comparison, deterministic, spends nothing
 *   npm run bench -- --json    the same, as JSON
 *
 * What this answers is the cost half of §43: given the same pipeline and the
 * same conversation, what do the four strategies cost, and where does the money
 * go. That half is arithmetic, so it needs no API key and no spending.
 *
 * What it deliberately does not do is score quality. A benchmark that printed a
 * quality number derived from token counts would be inventing the most
 * important column. The scenarios carry written expectations instead, to be
 * graded against real output - and §43's own warning applies: the goal is the
 * best useful analysis per euro, not the best score.
 */

import {
  SCENARIOS,
  scenarioCharacters,
  type Scenario,
} from "../src/lib/bench/scenarios";
import {
  STRATEGIES,
  STRATEGY_IDS,
  analysisShape,
  estimateStrategy,
  type StrategyEstimate,
} from "../src/lib/bench/strategies";
import type { AiTask } from "../src/lib/ai/routing";

/** The modules a typical paid analysis runs. */
const MODULES: AiTask[] = [
  "COMMUNICATION",
  "INTERACTION",
  "TOPICS",
  "EMOTIONAL_LANGUAGE",
  "CONFLICT",
  "TIMELINE",
  "PERSONAL_PROFILES",
];

/** Characters per token, close enough for a comparison between equals. */
const CHARS_PER_TOKEN = 3.5;

interface Row {
  scenario: string;
  kind: string;
  estimates: StrategyEstimate[];
}

function shapeFor(scenario: Scenario) {
  const characters = scenarioCharacters(scenario);
  return analysisShape({
    conversationTokens: Math.max(500, Math.round(characters / CHARS_PER_TOKEN)),
    imageCount: scenario.turns.filter((turn) => turn.media === "image").length,
    voiceCount: scenario.turns.filter((turn) => turn.media === "voice").length,
    modules: MODULES,
  });
}

function run(): Row[] {
  return SCENARIOS.map((scenario) => {
    const shapes = shapeFor(scenario);
    return {
      scenario: scenario.id,
      kind: scenario.kind,
      estimates: STRATEGY_IDS.map((id) => estimateStrategy(STRATEGIES[id], shapes)),
    };
  });
}

function dollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

function report(rows: Row[]): void {
  console.log("\nRouting cost comparison");
  console.log("Deterministic estimate at this deployment's configured prices.");
  console.log("No model is called and nothing is spent.\n");

  const header = [pad("scenario", 26), ...STRATEGY_IDS.map((id) => padLeft(id, 30))];
  console.log(header.join(""));
  console.log("-".repeat(26 + 30 * STRATEGY_IDS.length));

  for (const row of rows) {
    const cells = row.estimates.map((estimate) => padLeft(dollars(estimate.costMicros), 30));
    console.log([pad(row.scenario, 26), ...cells].join(""));
  }

  console.log("-".repeat(26 + 30 * STRATEGY_IDS.length));

  const totals = STRATEGY_IDS.map((id) =>
    rows.reduce(
      (sum, row) => sum + row.estimates.find((e) => e.strategy === id)!.costMicros,
      0,
    ),
  );
  console.log(
    [pad("total", 26), ...totals.map((total) => padLeft(dollars(total), 30))].join(""),
  );

  const baseline = totals[STRATEGY_IDS.indexOf("opus-heavy")]!;
  console.log("\nRelative to Opus-for-everything:");
  STRATEGY_IDS.forEach((id, index) => {
    const share = baseline === 0 ? 1 : totals[index]! / baseline;
    console.log(`  ${pad(id, 30)} ${padLeft(`${(share * 100).toFixed(1)}%`, 8)}`);
  });

  console.log("\nWhere the calls land, summed across scenarios:");
  for (const id of STRATEGY_IDS) {
    const tiers = rows.reduce(
      (acc, row) => {
        const estimate = row.estimates.find((e) => e.strategy === id)!;
        acc.cheap += estimate.callsByTier.cheap;
        acc.standard += estimate.callsByTier.standard;
        acc.deep += estimate.callsByTier.deep;
        return acc;
      },
      { cheap: 0, standard: 0, deep: 0 },
    );
    console.log(
      `  ${pad(id, 30)} cheap ${padLeft(tiers.cheap.toFixed(0), 5)}  standard ${padLeft(
        tiers.standard.toFixed(0),
        5,
      )}  deep ${padLeft(tiers.deep.toFixed(1), 6)}`,
    );
  }

  console.log("\nQuality is not scored here, on purpose.");
  console.log("Each scenario carries written expectations in src/lib/bench/scenarios.ts;");
  console.log("grade real output against those. Cheapest is only better at equal quality.\n");
}

const rows = run();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scenarios: rows }, null, 2));
} else {
  report(rows);
}
