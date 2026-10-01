import type { InstrumentSpec } from "@/types/instrument";
import type { ConversionDescription } from "@/types/risk";
import { getInstrument } from "@/lib/instruments";

/** Returns the current mid price of a symbol, if known. */
export type QuoteLookup = (symbol: string) => number | undefined;

export interface QuoteConversion {
  /** Multiplier from quote currency to account currency for P/L realised at `exitPrice`. */
  rateAt(exitPrice: number): number;
  description: ConversionDescription;
}

/** Symbols whose price is needed to convert this instrument's P/L into the account currency. */
export function conversionSymbols(instrument: InstrumentSpec, accountCurrency: string): string[] {
  if (instrument.quote === accountCurrency || instrument.base === accountCurrency) return [];
  return [`${instrument.quote}${accountCurrency}`, `${accountCurrency}${instrument.quote}`].filter(
    (s) => getInstrument(s) !== undefined,
  );
}

/**
 * How P/L in the instrument's quote currency becomes account currency.
 *
 * - quote = account (EURUSD, USD account): 1:1.
 * - base = account (USDJPY, USD account): P/L is in JPY and is realised when
 *   price reaches the exit, so it converts at the exit price itself (1 / exit).
 *   This is exact, rather than the common approximation using today's rate.
 * - otherwise (EURJPY, USD account; XAUUSD, EUR account): a cross rate from
 *   another pair at the current market price.
 */
export function resolveConversion(
  instrument: InstrumentSpec,
  accountCurrency: string,
  lookup: QuoteLookup,
): QuoteConversion | null {
  if (instrument.quote === accountCurrency) {
    return { rateAt: () => 1, description: { kind: "IDENTITY" } };
  }
  if (instrument.base === accountCurrency) {
    return {
      rateAt: (exitPrice) => 1 / exitPrice,
      description: {
        kind: "INVERSE_OF_PAIR",
        note: `${instrument.quote} P/L converted to ${accountCurrency} at the exit price`,
      },
    };
  }
  const direct = `${instrument.quote}${accountCurrency}`;
  const directPrice = lookup(direct);
  if (directPrice !== undefined && directPrice > 0) {
    return { rateAt: () => directPrice, description: { kind: "CROSS_RATE", via: direct, rate: directPrice } };
  }
  const inverse = `${accountCurrency}${instrument.quote}`;
  const inversePrice = lookup(inverse);
  if (inversePrice !== undefined && inversePrice > 0) {
    const rate = 1 / inversePrice;
    return { rateAt: () => rate, description: { kind: "CROSS_RATE", via: inverse, rate } };
  }
  return null;
}
