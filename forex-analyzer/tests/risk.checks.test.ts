import { describe, expect, it } from "vitest";
import { computeLimits } from "@/risk";
import { account, check, risk, settings } from "./helpers";

describe("structural validation", () => {
  it("blocks a LONG with the stop above entry (invalid SL) and computes nothing", () => {
    const report = risk({ stopLoss: 1.1755 });
    expect(report.status).toBe("BLOCKED");
    expect(check(report, "STOP_LOSS_SIDE").status).toBe("BLOCK");
    expect(check(report, "STOP_LOSS_SIDE").detail).toMatch(/must be below entry/);
    expect(report.calculation).toBeNull();
  });

  it("blocks a SHORT with the stop below entry", () => {
    const report = risk({ direction: "SHORT", entry: 1.1735, stopLoss: 1.1715, takeProfit: 1.1695 });
    expect(check(report, "STOP_LOSS_SIDE").status).toBe("BLOCK");
  });

  it("blocks a stop equal to entry", () => {
    expect(check(risk({ stopLoss: 1.1735 }), "STOP_LOSS_SIDE").detail).toMatch(/equals entry/);
  });

  it("blocks a LONG with the target below entry (invalid TP)", () => {
    const report = risk({ takeProfit: 1.17 });
    expect(report.status).toBe("BLOCKED");
    expect(check(report, "TAKE_PROFIT_SIDE").status).toBe("BLOCK");
  });

  it("blocks a SHORT with the target above entry", () => {
    const report = risk({ direction: "SHORT", entry: 1.1735, stopLoss: 1.1755, takeProfit: 1.18 });
    expect(check(report, "TAKE_PROFIT_SIDE").status).toBe("BLOCK");
  });

  it("blocks an unknown instrument", () => {
    const report = risk({ pair: "ABCXYZ" });
    expect(report.status).toBe("BLOCKED");
    expect(check(report, "PAIR_KNOWN").status).toBe("BLOCK");
  });

  it("blocks non-positive or non-finite prices", () => {
    expect(check(risk({ entry: -1 }), "PRICES_VALID").status).toBe("BLOCK");
    expect(check(risk({ takeProfit: Number.NaN }), "PRICES_VALID").status).toBe("BLOCK");
  });

  it("blocks an invalid direction even if it bypassed input validation", () => {
    expect(check(risk({ direction: "BUY" as never }), "DIRECTION_VALID").status).toBe("BLOCK");
  });
});

describe("account limits", () => {
  it("passes the reference trade on every check", () => {
    const report = risk();
    expect(report.status).toBe("PASS");
    expect(report.checks.every((c) => c.status === "PASS")).toBe(true);
  });

  it("blocks a pair that is not in the allowed list", () => {
    const report = risk({}, { settings: { allowedPairs: ["GBPUSD"] } });
    expect(check(report, "PAIR_ALLOWED").status).toBe("BLOCK");
    expect(report.status).toBe("BLOCKED");
  });

  it("blocks excessive risk: 1 lot on a 20-pip stop is 2% against a 0.5% maximum", () => {
    const report = risk({ positionSize: 1 });
    const c = check(report, "RISK_PER_TRADE");
    expect(c.status).toBe("BLOCK");
    expect(c.detail).toMatch(/2\.00%.*exceeds the configured maximum of 0\.50%/);
    expect(report.status).toBe("BLOCKED");
  });

  it("allows risk exactly at the limit", () => {
    expect(check(risk({ positionSize: 0.25 }), "RISK_PER_TRADE").status).toBe("PASS");
  });

  it("blocks when even the minimum lot exceeds the risk budget", () => {
    const report = risk({ pair: "XAUUSD", entry: 3850, stopLoss: 3000, takeProfit: 6000 });
    expect(report.calculation!.suggestedPositionSize).toBe(0);
    expect(report.calculation!.positionSize).toBe(0.01);
    expect(check(report, "POSITION_SIZE").status).toBe("BLOCK");
    expect(check(report, "RISK_PER_TRADE").status).toBe("BLOCK");
  });

  it("warns about a size that is not a multiple of the lot step", () => {
    expect(check(risk({ positionSize: 0.125 }), "POSITION_SIZE").status).toBe("WARNING");
  });

  it("blocks insufficient R:R", () => {
    const report = risk({ takeProfit: 1.1765 }); // 30 / 20 = 1.5 < 2
    expect(check(report, "RISK_REWARD").status).toBe("BLOCK");
    expect(report.status).toBe("BLOCKED");
  });

  it("blocks a trade whose loss would exceed the remaining daily loss", () => {
    // Day started at 10,050, now 9,600 after -450 today. Limit 500 of initial balance → floor 9,550 → 50 left.
    const report = risk(
      { positionSize: 0.3 }, // risk $60
      { settings: { maxRiskPerTradePct: 1 }, account: { balance: 9_600, dayStartBalance: 10_050, todayRealizedPnl: -450 } },
    );
    expect(report.limits.dailyLossRemaining).toBe(50);
    expect(check(report, "RISK_PER_TRADE").status).toBe("PASS");
    const c = check(report, "DAILY_LOSS");
    expect(c.status).toBe("BLOCK");
    expect(c.detail).toMatch(/would breach the daily loss limit/);
  });

  it("blocks any trade once the daily loss limit is reached", () => {
    const report = risk({}, { account: { balance: 9_500, dayStartBalance: 10_000, todayRealizedPnl: -500 } });
    expect(check(report, "DAILY_LOSS").detail).toMatch(/already reached/);
    expect(report.status).toBe("BLOCKED");
  });

  it("counts risk on open positions against the daily allowance", () => {
    const report = risk({}, { settings: { maxOpenPositions: 3 }, account: { openPositions: 1, openRisk: 470 } });
    expect(report.limits.dailyLossRemaining).toBe(30);
    expect(check(report, "DAILY_LOSS").status).toBe("BLOCK");
  });

  it("warns when a trade uses more than half of the remaining daily allowance", () => {
    const report = risk({}, { account: { balance: 9_920, dayStartBalance: 10_000, todayRealizedPnl: -80 } });
    // floor 9,500 → 420 left; risk 0.5% of 9,920 rounds down to 0.24 lots = $48: below half, so PASS
    expect(check(report, "DAILY_LOSS").status).toBe("PASS");
    const tight = risk({}, { account: { balance: 9_580, dayStartBalance: 10_000, todayRealizedPnl: -420 } });
    expect(check(tight, "DAILY_LOSS").status).toBe("WARNING");
    expect(tight.status).toBe("WARNING");
  });

  it("can size the daily limit from the day-start balance instead", () => {
    const limits = computeLimits(settings({ dailyLossBasis: "DAY_START_BALANCE" }), account({ balance: 12_000, dayStartBalance: 12_000 }));
    expect(limits.dailyLossLimit).toBe(600);
  });

  it("blocks a trade that would breach the maximum drawdown", () => {
    // Static floor 9,000; balance 9,050 → 50 left. Day started at 9,050 so the daily check has room.
    const report = risk({ positionSize: 0.3 }, { settings: { maxRiskPerTradePct: 1 }, account: { balance: 9_050, dayStartBalance: 9_050 } });
    expect(report.limits.drawdownRemaining).toBe(50);
    expect(check(report, "DAILY_LOSS").status).toBe("PASS");
    expect(check(report, "MAX_DRAWDOWN").status).toBe("BLOCK");
    expect(report.status).toBe("BLOCKED");
  });

  it("trailing drawdown follows the closed-balance high", () => {
    const limits = computeLimits(settings({ drawdownMode: "TRAILING" }), account({ balance: 10_500, dayStartBalance: 10_500, highWaterMark: 11_000 }));
    expect(limits.drawdownFloor).toBe(9_900);
    expect(limits.drawdownRemaining).toBe(600);
  });

  it("blocks when the maximum number of positions is already open", () => {
    const report = risk({}, { account: { openPositions: 1, openRisk: 50 } });
    expect(check(report, "POSITION_LIMIT").status).toBe("BLOCK");
    expect(report.status).toBe("BLOCKED");
  });

  it("warns (does not block) outside the configured sessions", () => {
    const report = risk({}, { settings: { tradingSessions: ["LONDON"] }, now: new Date("2026-09-30T03:00:00Z") });
    expect(check(report, "TRADING_SESSION").status).toBe("WARNING");
    expect(report.status).toBe("WARNING");
  });

  it("blocks when P/L cannot be converted to the account currency", () => {
    const report = risk({ pair: "XAUUSD", entry: 3850, stopLoss: 3840, takeProfit: 3870 }, { settings: { currency: "EUR" } });
    expect(check(report, "CONVERSION_RATE").status).toBe("BLOCK");
    expect(report.calculation).toBeNull();
    expect(report.status).toBe("BLOCKED");
  });
});
