# FX Trade Analyzer

A decision-support tool for proposed Forex (and gold) trades on funded accounts.

**Analyze → inform → you decide.** The application never places, modifies or closes orders. It has no broker
connection and no trading permissions.

```
You propose a trade
  → the deterministic risk engine checks the account rules   (BLOCK stops here; the AI is never called)
  → market data is fetched and verified                      (stale or missing → ANALYSIS UNAVAILABLE)
  → indicators and market structure are calculated
  → Claude evaluates the setup and returns strict JSON
  → the application combines both into a verdict              (the AI can only be capped, never override a BLOCK)
  → everything is saved to the journal
```

## Running it

Requires Node.js 20.19+ (22 LTS recommended).

```bash
cd forex-analyzer
npm install
npm run dev          # http://127.0.0.1:5173
```

No configuration is needed: without keys the app runs entirely in **mock mode**, with synthetic market data for EURUSD,
GBPUSD, USDJPY, XAUUSD and a few more pairs, and a rule-based mock analyst instead of Claude. Mock mode is labelled
in the top bar, on every verdict and in the AI summary, so it can't be mistaken for real analysis.

To use real services, copy `.env.example` to `.env` and fill in what you have:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Claude. Empty → mock analyst. |
| `ANTHROPIC_MODEL` | Default `claude-opus-5-5`. |
| `ANTHROPIC_EFFORT` | `low` … `max`, default `high`. |
| `ANTHROPIC_TIMEOUT_SECONDS` | Default 120. |
| `MARKET_DATA_PROVIDER` | `mock` or `twelvedata`. Defaults to `twelvedata` when a key is set. |
| `MARKET_DATA_API_KEY` | [Twelve Data](https://twelvedata.com) API key. |
| `MARKET_DATA_MAX_AGE_SECONDS` | A quote older than this is stale. Default 300. |
| `PORT`, `HOST` | Default `5173`, `127.0.0.1` (local only). |
| `DATABASE_PATH` | Default `./data/forex-analyzer.db` (created on first run). |

Keys are read by the server only. They are never sent to the browser, never stored in SQLite, and the Twelve Data key
travels in a header rather than the URL.

Other scripts:

```bash
npm test             # unit and integration tests (vitest)
npm run typecheck
npm run build        # production bundle
npm start            # serve the production build (run build first)
npm run verify       # typecheck + tests + build
npm run test:e2e     # browser test of the main flow; needs `npx playwright install chromium` once
```

## The three layers

They are separate modules with one-way dependencies, and only the first one has authority over the account.

### 1. Deterministic risk engine (`src/risk`)

Pure functions, no I/O: `calculateRR()`, `calculateRisk()`, `validateTrade()`, `checkAccountLimits()`, `runRiskEngine()`.

- **Distances**: LONG risk = entry − SL, reward = TP − entry; SHORT risk = SL − entry, reward = entry − TP.
  R:R = reward ÷ risk. Distances are rounded just beyond quote precision so 1:2 is exactly 1:2.
- **Money** is always price distance × contract size × lots, converted to the account currency. Pip size only affects
  how distances are displayed. Instruments are modelled generically: XAUUSD is a metal with a 100 oz contract, not a
  currency pair.
- **Currency conversion**:
  - quote currency = account currency (EURUSD on a USD account) → 1:1;
  - base currency = account currency (USDJPY on a USD account) → the JPY P/L is converted **at the exit price**
    (stop or target), which is exact rather than the usual "today's rate" approximation;
  - otherwise (EURJPY on a USD account, XAUUSD on a EUR account) via a cross rate from the market (USDJPY, EURUSD).
    If no rate is available the trade is blocked, because its risk can't be verified.
- **Position size**: when not given, the largest size that keeps risk within the per-trade limit, **rounded down** to
  the 0.01 lot step. If even 0.01 lots exceeds the budget, the trade is blocked and the money figures show what the
  minimum lot would risk.

  Example, USDJPY long 150.00 / SL 149.50, $10,000, 0.5%: $334.45 lost per lot at the stop → 0.14 lots ($46.82).
  The common shortcut gives 0.15 lots, which would actually lose $50.17 and break the limit.

Each check returns `PASS`, `WARNING` or `BLOCK`:

| Check | BLOCK when | WARNING when |
|---|---|---|
| Instrument recognised, direction valid, prices valid | input is unusable | – |
| Stop loss / take profit on the correct side | wrong side or equal to entry | – |
| Currency conversion | no rate to convert P/L | – |
| Pair allowed | not in your allowed list | – |
| Position size | below min lot, or no size fits the budget | not a multiple of the lot step |
| Risk within limit | risk > max risk per trade | – |
| R:R requirement | R:R < your minimum | – |
| Daily loss within limit | losing this trade would cross the daily floor, or it is already reached | trade uses > 50% of what is left |
| Drawdown within limit | losing this trade would cross the drawdown floor | trade uses > 50% of what is left |
| Position limit | max simultaneous positions already open | – |
| Trading session | – | outside your configured sessions |

Daily loss and drawdown assume every open position loses its full risk (worst case). The daily limit can be sized from
the initial balance or the day-start balance; drawdown can be static or trailing; the trading day resets in a time zone
you choose. **None of these are assumed to be universal prop-firm rules.** They are your settings.

Account figures (balance, today's P/L, open positions and their risk) come from the journal by default: closed trades'
P/L and entries marked *Open*. You can switch to entering them manually in Settings.

### 2. Market and technical analysis (`src/services/market`, `src/technical`)

- `MarketDataProvider` is an interface (`getCurrentPrice`, `getCandles`); the analysis depends only on it.
  - `MockMarketDataProvider`: deterministic synthetic data (seeded random walk with trend regimes, volatility
    clustering and session activity), generated at M5 and aggregated so all timeframes agree. It trades 24/7.
  - `TwelveDataProvider`: real quotes and candles for M5–D1. Twelve Data does not report bid/ask, so the spread is
    shown as "not reported" rather than guessed.
  - `CachedMarketDataProvider` wraps either one for a few seconds to protect rate limits.
- Before anything is analysed, data is verified: quote age, candle count, time order, OHLC consistency, the latest
  candle's age, and whether the quote agrees with the candles. Any failure → **ANALYSIS UNAVAILABLE — Market data
  could not be verified.** No verdict is produced.
- Per timeframe (e.g. H4, H1, M15, M5 for an M15 trade): EMA 20/50/200, RSI 14 (Wilder), ATR 14 (Wilder), volatility
  regime (current ATR vs its 100-bar median), fractal swing highs/lows, HH/HL/LH/LL labels, a structure bias
  (BULLISH / BEARISH / RANGE / UNCLEAR with the rule that produced it) and clustered support/resistance.
- Deterministic market checks: spread as a share of the stop, stop width in ATRs, entry distance from price in ATRs.

None of these is treated as a signal. They are inputs to the assessment.

### 3. Claude (`src/ai`)

- `buildClaudePayload()` sends structured JSON only: the trade, the risk engine's figures, per-timeframe metrics,
  derived distances, market checks, a list of missing data, and your thesis (marked as a claim to evaluate, not an
  instruction).
- The system prompt is a separate file: `src/ai/prompts/trade-analyst.system.md`.
- The response is constrained with structured outputs (`output_config.format`, a JSON Schema generated from the zod
  schema in `src/ai/schema.ts`) and validated again by `parseClaudeResponse()`. Prose, malformed JSON, unknown
  verdicts or extra fields fail the analysis; they are never interpreted.
- Verdicts are `ACCEPTABLE`, `CAUTION` or `REJECT`. The 0–100 setup score is a heuristic and is labelled as **not a
  probability** everywhere it appears. Missing data → that component is `UNKNOWN`.
- Requests use `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), so if a safety classifier declines, the
  API re-runs the request on its recommended fallback model. If that happens the result says which model answered.
- Timeouts, rate limits, auth errors, refusals and truncated answers all become **ANALYSIS UNAVAILABLE**, with the
  risk engine's results still shown.

### How the final verdict is decided (`src/services/analysis/decision.ts`)

1. Risk engine BLOCK → **TRADE BLOCKED**. The AI is not called, so it cannot override this.
2. Unverified market data or a failed or invalid AI response → **ANALYSIS UNAVAILABLE**.
3. Otherwise the AI's verdict, **capped at CAUTION** by any rule warning, a capping market check, or a score below your
   minimum setup score. Application rules can only lower the verdict, never raise it.

## Journal and dashboard

Every analysis is saved, blocked and unavailable ones included: inputs, risk figures, verdicts, AI reasoning and a
market snapshot (with candles to redraw the chart). Record the outcome later (Open, Win, Loss, Breakeven, Cancelled)
with actual P/L. The R multiple is derived from P/L ÷ analysed risk unless you enter one. Filter by pair, verdict, score
range, result and date.

The dashboard shows balance, today's P/L, remaining daily loss and drawdown, open positions and journal statistics.
**AI score vs outcome** stays a progress bar until 30 closed, scored trades exist. After that it shows a scatter, score
buckets and a rank correlation, all labelled as descriptive, not as evidence that the score predicts anything.

## Project structure

```
src/
  main.tsx, index.css     browser entry
  pages/                  Dashboard, Trade Analyzer, Journal, Settings
  components/             UI (no business logic)
  hooks/                  data loading, debounced risk preview
  lib/                    shared pure code: instruments, schemas, formatting, API client
  types/                  shared types
  risk/                   deterministic risk engine            (pure)
  technical/              indicators, structure, levels        (pure)
  ai/                     Claude client, prompt, schema, parser, mock analyst      server only
  services/               market data providers, analysis pipeline, statistics    server only
  database/               SQLite (better-sqlite3), migrations, repositories        server only
  api/                    Express routes and input validation                     server only
  server/                 config, wiring, dev/production server                   server only
tests/                    vitest: risk engine, technicals, AI parsing, Claude client, pipeline, DB, API, boundaries
e2e/                      Playwright: the main user flow in a real browser
```

`tests/boundaries.test.ts` walks the browser bundle's import graph and fails if it can reach any server-only folder or
`process.env`.

In development one process serves both the API and the Vite dev server (`npm run dev`). In production the same Express
server serves the built files from `dist/`.

## Not implemented, deliberately

No order execution, position management, stop or target movement, copy trading, broker login or API trading
permissions. Execution could be added later as another consumer of the same analysis result; nothing in the
current code path sends anything to a broker.

## Known limitations

- The mock market is synthetic and ignores weekends; its crosses are not derived from the majors.
- Twelve Data has no spread data, and on the free tier allows about 8 requests a minute. One analysis needs about 5–6.
- When the market is closed, real data goes stale and the analysis is (correctly) unavailable.
- Session windows are approximate fixed UTC hours, not adjusted for daylight saving time.
