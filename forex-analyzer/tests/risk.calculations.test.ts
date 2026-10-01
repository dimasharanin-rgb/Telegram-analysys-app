import { describe, expect, it } from "vitest";
import { calculateRR, calculateRisk, resolveConversion } from "@/risk";
import { getInstrument } from "@/shared/instruments";
import { quotes, risk, trade } from "./helpers";

const EURUSD = getInstrument("EUR/USD")!;
const USDJPY = getInstrument("USD/JPY")!;

describe("calculateRR", () => {
  it("LONG: risk = entry - SL, reward = TP - entry", () => {
    const r = calculateRR(trade(), EURUSD);
    expect(r.riskDistance).toBeCloseTo(0.002, 10);
    expect(r.rewardDistance).toBeCloseTo(0.004, 10);
    expect(r.riskReward).toBe(2);
  });

  it("SHORT: risk = SL - entry, reward = entry - TP", () => {
    const r = calculateRR(trade({ direction: "SHORT", entry: 1.35, stopLoss: 1.353, takeProfit: 1.344 }), EURUSD);
    expect(r.riskDistance).toBeCloseTo(0.003, 10);
    expect(r.rewardDistance).toBeCloseTo(0.006, 10);
    expect(r.riskReward).toBe(2);
  });

  it("is not thrown off by binary floating point (exactly 1:2 stays 1:2)", () => {
    expect(calculateRR(trade({ entry: 1.1735, stopLoss: 1.1715, takeProfit: 1.1775 }), EURUSD).riskReward).toBe(2);
    expect(calculateRR(trade({ entry: 0.3, stopLoss: 0.1, takeProfit: 0.7 }), EURUSD).riskReward).toBe(2);
  });

  it("reports negative distances when SL or TP is on the wrong side", () => {
    const r = calculateRR(trade({ stopLoss: 1.1755 }), EURUSD);
    expect(r.riskDistance).toBeLessThan(0);
    expect(r.riskReward).toBeNaN();
  });
});

describe("calculateRisk", () => {
  it("LONG EURUSD on a USD account: suggests the size that risks 0.5%", () => {
    const report = risk();
    const c = report.calculation!;
    expect(report.status).toBe("PASS");
    expect(c.riskPips).toBe(20);
    expect(c.rewardPips).toBe(40);
    expect(c.pipValuePerLot).toBe(10);
    expect(c.suggestedPositionSize).toBe(0.25);
    expect(c.positionSize).toBe(0.25);
    expect(c.positionSizeSource).toBe("SUGGESTED");
    expect(c.units).toBe(25_000);
    expect(c.riskAmount).toBe(50);
    expect(c.rewardAmount).toBe(100);
    expect(c.riskPercent).toBe(0.5);
    expect(c.riskReward).toBe(2);
  });

  it("SHORT GBPUSD: rounds the size down so risk never exceeds the limit", () => {
    const c = risk({ pair: "GBPUSD", direction: "SHORT", entry: 1.35, stopLoss: 1.353, takeProfit: 1.344 }).calculation!;
    expect(c.riskPips).toBe(30);
    expect(c.suggestedPositionSize).toBe(0.16); // 50 / 300 per lot = 0.1666 → 0.16
    expect(c.riskAmount).toBe(48);
    expect(c.rewardAmount).toBe(96);
    expect(c.riskPercent).toBeLessThanOrEqual(0.5);
  });

  it("uses the user's position size when given", () => {
    const c = risk({ positionSize: 0.1 }).calculation!;
    expect(c.positionSizeSource).toBe("USER");
    expect(c.positionSize).toBe(0.1);
    expect(c.riskAmount).toBe(20);
    expect(c.rewardAmount).toBe(40);
    expect(c.riskPercent).toBeCloseTo(0.2, 10);
    expect(c.suggestedPositionSize).toBe(0.25);
  });

  it("JPY pair (USDJPY, USD account): 0.01 pip, P/L converted at the exit price", () => {
    const report = risk({ pair: "USDJPY", entry: 150, stopLoss: 149.5, takeProfit: 151 });
    const c = report.calculation!;
    expect(report.status).toBe("PASS");
    expect(c.riskPips).toBe(50);
    expect(c.rewardPips).toBe(100);
    // one pip on one lot = 0.01 * 100,000 JPY = 1,000 JPY = $6.67 at 150.00
    expect(c.pipValuePerLot).toBeCloseTo(6.6667, 4);
    // loss per lot = 0.5 * 100,000 JPY = 50,000 JPY = $334.45 at the stop (149.50)
    // 50 / 334.45 = 0.1495 → 0.14 lots. (0.15 lots, from the naive formula, would risk $50.17.)
    expect(c.suggestedPositionSize).toBe(0.14);
    expect(c.riskAmount).toBeCloseTo(46.82, 2);
    expect(c.rewardAmount).toBeCloseTo((1 * 100_000 * 0.14) / 151, 2);
    expect(c.riskAmount).toBeLessThanOrEqual(50);
  });

  it("JPY cross (EURJPY, USD account) converts through USDJPY", () => {
    const c = risk({ pair: "EURJPY", entry: 160, stopLoss: 159.7, takeProfit: 160.6 }, { settings: { allowedPairs: ["EURJPY"] }, quotes: { "USD/JPY": 150 } }).calculation!;
    expect(c.conversion).toEqual({ kind: "CROSS_RATE", via: "USD/JPY", rate: 1 / 150 });
    expect(c.riskPips).toBe(30);
    expect(c.suggestedPositionSize).toBe(0.25); // 0.3 * 100,000 / 150 = $200 per lot
    expect(c.riskAmount).toBe(50);
  });

  it("gold is sized from its 100 oz contract, not as a currency pair", () => {
    const c = risk({ pair: "XAUUSD", entry: 3850, stopLoss: 3840, takeProfit: 3870 }).calculation!;
    expect(c.riskPips).toBe(100); // pip = 0.10
    expect(c.suggestedPositionSize).toBe(0.05); // $10 * 100 oz = $1,000 per lot
    expect(c.riskAmount).toBe(50);
    expect(c.rewardAmount).toBe(100);
  });

  it("EUR account trading EURUSD converts USD P/L back to EUR", () => {
    const c = risk({}, { settings: { currency: "EUR" } }).calculation!;
    expect(c.conversion.kind).toBe("INVERSE_OF_PAIR");
    // 0.002 * 100,000 USD / 1.1715 = €170.72 per lot → 0.29 lots
    expect(c.suggestedPositionSize).toBe(0.29);
    expect(c.riskAmount).toBeCloseTo(49.51, 2);
  });

  it("measures risk % against the current balance", () => {
    const c = risk({ positionSize: 0.25 }, { account: { balance: 12_500 } }).calculation!;
    expect(c.riskAmount).toBe(50);
    expect(c.riskPercent).toBeCloseTo(0.4, 10);
  });

  it("calculateRisk can be used directly with a resolved conversion", () => {
    const conversion = resolveConversion(USDJPY, "USD", quotes())!;
    const c = calculateRisk({ trade: trade({ pair: "USDJPY", entry: 150, stopLoss: 149.5, takeProfit: 151 }), instrument: USDJPY, accountCurrency: "USD", equity: 10_000, maxRiskPercent: 1, conversion });
    expect(c.suggestedPositionSize).toBe(0.29);
  });
});
