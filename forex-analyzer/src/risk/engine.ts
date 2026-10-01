import type { AccountState, RiskCheck, RiskReport, RiskReportStatus } from "@/shared/types/risk";
import type { AccountSettings } from "@/shared/types/settings";
import type { TradeInput } from "@/shared/types/trade";
import { getInstrument, normalizeSymbol } from "@/shared/instruments";
import { calculateRisk } from "@/risk/calculations";
import { resolveConversion, type QuoteLookup } from "@/risk/conversion";
import { checkAccountLimits, computeLimits } from "@/risk/limits";
import { validateTrade } from "@/risk/validation";

export interface RiskEngineInput {
  trade: TradeInput;
  settings: AccountSettings;
  account: AccountState;
  /** Current prices for currency conversion (only needed for cross pairs). */
  quotes: QuoteLookup;
  now: Date;
}

export function overallStatus(checks: RiskCheck[]): RiskReportStatus {
  if (checks.some((c) => c.status === "BLOCK")) return "BLOCKED";
  if (checks.some((c) => c.status === "WARNING")) return "WARNING";
  return "PASS";
}

/**
 * The deterministic risk engine. It runs before any market or AI analysis and
 * its BLOCK is final: nothing downstream can turn a BLOCKED trade into an
 * acceptable one.
 */
export function runRiskEngine(input: RiskEngineInput): RiskReport {
  const { settings, account, now } = input;
  const trade: TradeInput = { ...input.trade, pair: normalizeSymbol(input.trade.pair) };
  const instrument = getInstrument(trade.pair);
  const limits = computeLimits(settings, account);

  const checks = validateTrade(trade, instrument);
  const structurallyValid = instrument !== undefined && checks.every((c) => c.status !== "BLOCK");

  if (!instrument) {
    return { status: "BLOCKED", checks, calculation: null, limits, account };
  }

  let calculation = null;
  if (structurallyValid) {
    const conversion = resolveConversion(instrument, settings.currency, input.quotes);
    if (!conversion) {
      checks.push({
        id: "CONVERSION_RATE",
        label: "Currency conversion",
        status: "BLOCK",
        detail: `No ${instrument.quote}/${settings.currency} rate is available, so the risk in ${settings.currency} cannot be verified.`,
      });
    } else {
      calculation = calculateRisk({
        trade,
        instrument,
        accountCurrency: settings.currency,
        equity: account.balance,
        maxRiskPercent: settings.maxRiskPerTradePct,
        conversion,
      });
      const d = conversion.description;
      checks.push({
        id: "CONVERSION_RATE",
        label: "Currency conversion",
        status: "PASS",
        detail:
          d.kind === "IDENTITY"
            ? `P/L is in ${settings.currency}; no conversion needed.`
            : d.kind === "INVERSE_OF_PAIR"
              ? `${d.note}.`
              : `${instrument.quote}→${settings.currency} via ${d.via} (${d.rate.toFixed(5)}).`,
      });
    }
  }

  checks.push(...checkAccountLimits({ trade, instrument, settings, account, limits, calculation, now }));

  return { status: overallStatus(checks), checks, calculation, limits, account };
}
