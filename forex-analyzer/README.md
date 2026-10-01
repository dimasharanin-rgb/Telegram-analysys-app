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
cp .env.example .env      # add TWELVE_DATA_API_KEY (and ANTHROPIC_API_KEY when ready)
npm install
npm run dev               # http://127.0.0.1:5173
```

| Variable | Purpose |
|---|---|
| `TWELVE_DATA_API_KEY` | Real market data (REST + WebSocket). Required for LIVE mode. |
| `ANTHROPIC_API_KEY` | Claude analysis. Empty → a clearly labelled mock analyst. |
| `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`, `ANTHROPIC_TIMEOUT_SECONDS` | Default `claude-opus-5-5`, `high`, 120. |
| `TWELVE_DATA_REST_POLL_SECONDS` | Quote polling interval used **only** while the WebSocket is down. Default 30. |
| `CANDLE_CACHE_TTL_SECONDS` | Per-timeframe candle cache lifetimes, e.g. `M5=20,H1=90`. |
| `PORT`, `HOST`, `DATABASE_PATH` | Default `5173`, `127.0.0.1`, `./data/forex-analyzer.db`. |

Keys are read by the server only. The browser talks to this application's server, which talks to Twelve Data and
Anthropic; no key is ever sent to the browser or stored in SQLite.

### LIVE and MOCK data

The **DATA MODE** switch in the top bar selects the source:

- **LIVE** (default): Twelve Data. If the key is missing or Twelve Data fails, the app shows
  **LIVE DATA UNAVAILABLE** and the reason. It never substitutes synthetic data while in LIVE mode.
- **MOCK**: a deterministic synthetic market (EUR/USD, GBP/USD, USD/JPY and others) for development. Marked
  **MOCK DATA** and **SIMULATED** everywhere.

The connection indicator shows **● LIVE**, **● RECONNECTING** or **● OFFLINE**, and every price shows
"Data: N seconds ago". Data older than the freshness threshold (Settings, default 120 s) is marked **STALE DATA** and
is not analysed. Outside Forex market hours real data is legitimately stale.

Other scripts:

```bash
npm test             # unit and integration tests (vitest)
npm run typecheck
npm run build        # production bundle
npm start            # serve the production build (run build first)
npm run verify       # typecheck + tests + build
npm run test:e2e     # browser tests; needs `npx playwright install chromium` once
```

## Market data layer (`src/data`)

Everything else depends on the `MarketDataProvider` interface (`getQuote`, `getCandles`, `searchSymbols`) or on
`MarketDataService`, which implements it. Twelve Data's wire format never leaves `src/data/twelvedata`.

- `twelvedata/normalize.ts`: pure translation of `/time_series`, `/quote`, `/forex_pairs`, WebSocket `price` events
  and error payloads into `Candle`, `Quote` and `Instrument`. Typed errors: invalid key, rate limit/credits, plan
  restriction, invalid symbol, timeouts, no data.
- `twelvedata/provider.ts`: REST client. The key goes in the `Authorization: apikey …` header, never in a URL. The
  Forex pair list is fetched at most once a day and searched locally.
- `twelvedata/priceStream.ts`: the WebSocket (`/v1/quotes/price`). It connects only while a symbol is being watched,
  reference-counts subscriptions, sends `{"action":"heartbeat"}` every 10 s, reconnects with exponential backoff if the
  line drops or goes silent, resubscribes after reconnecting, reports symbols the plan rejects, and stops retrying if
  the key is refused.
- `marketDataService.ts`: mode switching, plus credit conservation. In order:
  1. **Candles** are cached per timeframe: M1 15 s, M5 30 s, M15 60 s, M30 90 s, H1 2 min, H2 4 min, H4 5 min,
     D1 15 min. Concurrent requests share one call.
  2. **The forming candle** is kept current from the stream instead of refetching.
  3. **The latest price** comes from the stream when it is fresh, so no REST quote is spent.
  4. **If the WebSocket is unavailable**, quotes are polled sparingly (default every 30 s) and only while someone is
     watching.
- `snapshot()` builds one coherent `MarketDataSnapshot`: quote plus M5/M15/H1/H4 candles, `dataTimestamp`,
  `retrievedAt` and a staleness verdict.
- `usage.ts`: request, error, cache and stream counters, shown in **Developer Mode** (Settings) at the bottom of
  the screen.

The browser receives prices through a server-sent-events endpoint (`/api/stream?symbol=EUR/USD`). The server holds
the one upstream WebSocket and fans prices out. Live prices only update the screen; they never trigger an AI call.

Instruments are not hardcoded. Any pair of recognised ISO currencies works (`EUR/USD`, `AUD/NZD`, …). Pip size is
derived from the quote currency (0.01 for JPY, 0.0001 otherwise), and metals have their own contract. Add or remove
pairs in Settings → Watchlist, which searches Twelve Data's symbol list.

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



### 2. Technical analysis (`src/technical`)

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

### How the final verdict is decided (`src/analysis/decision.ts`)

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
  data/         market data: provider interface, Twelve Data REST + WebSocket, mock, cache, freshness   (server)
  technical/    indicators, swing structure, support/resistance                                       (pure)
  risk/         deterministic risk engine — imports nothing from ai/                                  (pure)
  ai/           Claude client, system prompt, output schema, parser, mock analyst                      (server)
  analysis/     the pipeline that runs the layers in order                                             (server)
  journal/      SQLite, journal repository, statistics                                                 (server)
  server/       Express API, SSE price stream, config, settings                                        (server)
  shared/       types, instrument specs, schemas, formatting                                           (pure, both sides)
  ui/           React pages, components and hooks                                                      (browser)
tests/          vitest: risk, technicals, Twelve Data normalisation, WebSocket (against a local fake), cache,
                freshness, AI parsing, Claude client, pipeline, DB, API, client/server boundary
e2e/            Playwright: data mode, live price/chart/timestamp, and the full analysis flow
```

`tests/boundaries.test.ts` walks the browser bundle's import graph and fails if it can reach `data/`, `ai/`,
`journal/`, `analysis/`, `server/` or `process.env`.

## Not implemented, deliberately

No order execution, position management, stop or target movement, copy trading, broker login or API trading
permissions. Execution could be added later as another consumer of the same analysis result; nothing in the
current code path sends anything to a broker.

## Known limitations

- Twelve Data's REST `/quote` has no bid/ask; the spread comes from the WebSocket. When only REST is available the
  spread is shown as n/a rather than guessed.
- WebSocket access depends on the Twelve Data plan; when it is refused the app falls back to sparse REST polling and
  says so.
- The mock market is synthetic, has no M1 data, ignores weekends, and its crosses are not derived from the majors.
- When the market is closed, real data goes stale and the analysis is (correctly) unavailable.
- Session windows are approximate fixed UTC hours, not adjusted for daylight saving time.
