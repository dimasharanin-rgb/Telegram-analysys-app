import type { InstrumentSpec } from "@/shared/types/instrument";
import type { AccountLimitsSnapshot, AccountState, RiskCalculation, RiskCheck } from "@/shared/types/risk";
import type { AccountSettings } from "@/shared/types/settings";
import type { TradeInput } from "@/shared/types/trade";
import { formatMoney, formatPct } from "@/shared/format";
import { gte, isMultipleOf, lte, round } from "@/shared/math";
import { activeSessions, SESSION_WINDOWS_UTC } from "@/shared/sessions";

/** Share of the remaining daily/total allowance above which a trade earns a WARNING. */
export const ALLOWANCE_WARNING_SHARE = 0.5;

/** What the configured limits leave room for, before the proposed trade. */
export function computeLimits(settings: AccountSettings, account: AccountState): AccountLimitsSnapshot {
  const dailyBasis = settings.dailyLossBasis === "INITIAL_BALANCE" ? settings.accountSize : account.dayStartBalance;
  const dailyLossLimit = (dailyBasis * settings.maxDailyLossPct) / 100;
  const dailyLossFloor = account.dayStartBalance - dailyLossLimit;

  const ddBasis =
    settings.drawdownMode === "TRAILING" ? Math.max(account.highWaterMark, settings.accountSize) : settings.accountSize;
  const drawdownLimit = (ddBasis * settings.maxDrawdownPct) / 100;
  const drawdownFloor = ddBasis - drawdownLimit;

  // Measured on equity (floating P/L included), and open positions are assumed
  // to lose their full remaining risk: the worst case the limits must survive.
  const worstCaseEquity = account.equity - account.openRisk;

  return {
    dailyLossLimit: round(dailyLossLimit, 2),
    dailyLossFloor: round(dailyLossFloor, 2),
    dailyLossRemaining: round(worstCaseEquity - dailyLossFloor, 2),
    drawdownLimit: round(drawdownLimit, 2),
    drawdownFloor: round(drawdownFloor, 2),
    drawdownRemaining: round(worstCaseEquity - drawdownFloor, 2),
    maxRiskAmount: round((account.balance * settings.maxRiskPerTradePct) / 100, 2),
    positionsRemaining: settings.maxOpenPositions - account.openPositions,
  };
}

function allowanceCheck(
  id: "DAILY_LOSS" | "MAX_DRAWDOWN",
  label: string,
  name: string,
  risk: number,
  remaining: number,
  currency: string,
): RiskCheck {
  const money = (v: number) => formatMoney(v, currency);
  if (remaining <= 0) {
    return { id, label, status: "BLOCK", detail: `The ${name} limit is already reached (remaining ${money(remaining)}).` };
  }
  if (!lte(risk, remaining)) {
    return {
      id,
      label,
      status: "BLOCK",
      detail: `Losing this trade (${money(risk)}) would breach the ${name} limit: only ${money(remaining)} remains.`,
    };
  }
  const share = risk / remaining;
  if (share > ALLOWANCE_WARNING_SHARE) {
    return {
      id,
      label,
      status: "WARNING",
      detail: `Risk ${money(risk)} uses ${formatPct(share * 100, 0)} of the remaining ${name} allowance (${money(remaining)}).`,
    };
  }
  return { id, label, status: "PASS", detail: `Risk ${money(risk)} of ${money(remaining)} remaining.` };
}

export interface AccountLimitInput {
  trade: TradeInput;
  instrument: InstrumentSpec;
  settings: AccountSettings;
  account: AccountState;
  limits: AccountLimitsSnapshot;
  /** Null when the trade is structurally invalid; money-dependent checks are then skipped. */
  calculation: RiskCalculation | null;
  now: Date;
}

/** Funded-account and personal-rule checks. A BLOCK here means the trade must not reach AI analysis. */
export function checkAccountLimits(input: AccountLimitInput): RiskCheck[] {
  const { trade, instrument, settings, account, limits, calculation, now } = input;
  const ccy = settings.currency;
  const checks: RiskCheck[] = [];

  const allowed = settings.allowedPairs.includes(instrument.symbol);
  checks.push({
    id: "PAIR_ALLOWED",
    label: "Pair allowed",
    status: allowed ? "PASS" : "BLOCK",
    detail: allowed
      ? `${instrument.symbol} is in your allowed list.`
      : `${instrument.symbol} is not in your allowed instruments (${settings.allowedPairs.join(", ") || "none"}).`,
  });

  if (calculation) {
    const userSize = trade.positionSize ?? null;
    if (userSize !== null && userSize > 0) {
      if (userSize < instrument.minLot) {
        checks.push({ id: "POSITION_SIZE", label: "Position size", status: "BLOCK", detail: `${userSize} lots is below the minimum of ${instrument.minLot}.` });
      } else if (!isMultipleOf(userSize, instrument.lotStep)) {
        checks.push({ id: "POSITION_SIZE", label: "Position size", status: "WARNING", detail: `${userSize} lots is not a multiple of the ${instrument.lotStep} lot step; brokers will reject or round it.` });
      } else {
        checks.push({ id: "POSITION_SIZE", label: "Position size", status: "PASS", detail: `Your size: ${userSize.toFixed(2)} lots (risk-limited size would be ${calculation.suggestedPositionSize.toFixed(2)}).` });
      }
    } else if (calculation.suggestedPositionSize > 0) {
      checks.push({ id: "POSITION_SIZE", label: "Position size", status: "PASS", detail: `Suggested ${calculation.suggestedPositionSize.toFixed(2)} lots keeps risk within ${formatPct(settings.maxRiskPerTradePct)}.` });
    } else {
      checks.push({ id: "POSITION_SIZE", label: "Position size", status: "BLOCK", detail: `Stop is too wide for the risk budget: even ${instrument.minLot} lots would risk ${formatMoney(calculation.riskAmount, ccy)}.` });
    }

    const riskOk = lte(calculation.riskAmount, limits.maxRiskAmount);
    checks.push({
      id: "RISK_PER_TRADE",
      label: "Risk within limit",
      status: riskOk ? "PASS" : "BLOCK",
      detail: riskOk
        ? `${formatPct(calculation.riskPercent)} (${formatMoney(calculation.riskAmount, ccy)}) ≤ max ${formatPct(settings.maxRiskPerTradePct)} (${formatMoney(limits.maxRiskAmount, ccy)}).`
        : `Risk ${formatPct(calculation.riskPercent)} (${formatMoney(calculation.riskAmount, ccy)}) exceeds the configured maximum of ${formatPct(settings.maxRiskPerTradePct)} (${formatMoney(limits.maxRiskAmount, ccy)}).`,
    });

    const rrOk = gte(round(calculation.riskReward, 4), settings.minRiskReward);
    checks.push({
      id: "RISK_REWARD",
      label: "R:R requirement",
      status: rrOk ? "PASS" : "BLOCK",
      detail: rrOk
        ? `1 : ${calculation.riskReward.toFixed(2)} meets the minimum 1 : ${settings.minRiskReward.toFixed(2)}.`
        : `1 : ${calculation.riskReward.toFixed(2)} is below the minimum 1 : ${settings.minRiskReward.toFixed(2)}.`,
    });

    checks.push(allowanceCheck("DAILY_LOSS", "Daily loss within limit", "daily loss", calculation.riskAmount, limits.dailyLossRemaining, ccy));
    checks.push(allowanceCheck("MAX_DRAWDOWN", "Drawdown within limit", "maximum drawdown", calculation.riskAmount, limits.drawdownRemaining, ccy));
  }

  const positionsOk = account.openPositions < settings.maxOpenPositions;
  checks.push({
    id: "POSITION_LIMIT",
    label: "Position limit",
    status: positionsOk ? "PASS" : "BLOCK",
    detail: positionsOk
      ? `${account.openPositions} of ${settings.maxOpenPositions} positions open; this would be #${account.openPositions + 1}.`
      : `${account.openPositions} of ${settings.maxOpenPositions} allowed positions are already open.`,
  });

  if (settings.tradingSessions.length === 0) {
    checks.push({ id: "TRADING_SESSION", label: "Trading session", status: "PASS", detail: "No session restriction configured." });
  } else {
    const active = activeSessions(now);
    const matching = active.filter((s) => settings.tradingSessions.includes(s));
    const names = (list: string[]) => list.map((s) => SESSION_WINDOWS_UTC[s as keyof typeof SESSION_WINDOWS_UTC].label).join(", ");
    checks.push(
      matching.length > 0
        ? { id: "TRADING_SESSION", label: "Trading session", status: "PASS", detail: `${names(matching)} session active.` }
        : {
            id: "TRADING_SESSION",
            label: "Trading session",
            status: "WARNING",
            detail: `Outside your sessions (${names(settings.tradingSessions)}). Active now: ${active.length ? names(active) : "none"}.`,
          },
    );
  }

  return checks;
}
