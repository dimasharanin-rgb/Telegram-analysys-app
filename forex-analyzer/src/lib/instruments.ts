import type { InstrumentSpec } from "@/types/instrument";

function fx(base: string, quote: string): InstrumentSpec {
  const jpy = quote === "JPY";
  return {
    symbol: `${base}${quote}`,
    displayName: `${base}/${quote}`,
    assetClass: "FX",
    base,
    quote,
    pipSize: jpy ? 0.01 : 0.0001,
    pricePrecision: jpy ? 3 : 5,
    contractSize: 100_000,
    minLot: 0.01,
    lotStep: 0.01,
  };
}

/**
 * Instruments the analyzer knows how to size. Gold is modelled as a metal with
 * a 100 oz contract, not as a currency pair; its "pip" of 0.10 is a display
 * convention that varies between brokers and never affects money figures.
 */
export const INSTRUMENTS: readonly InstrumentSpec[] = [
  fx("EUR", "USD"),
  fx("GBP", "USD"),
  fx("USD", "JPY"),
  {
    symbol: "XAUUSD",
    displayName: "XAU/USD",
    assetClass: "METAL",
    base: "XAU",
    quote: "USD",
    pipSize: 0.1,
    pricePrecision: 2,
    contractSize: 100,
    minLot: 0.01,
    lotStep: 0.01,
  },
  fx("AUD", "USD"),
  fx("NZD", "USD"),
  fx("USD", "CAD"),
  fx("USD", "CHF"),
  fx("EUR", "GBP"),
  fx("EUR", "JPY"),
  fx("GBP", "JPY"),
];

const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

export function normalizeSymbol(raw: string): string {
  return raw.replace(/[^a-zA-Z]/g, "").toUpperCase();
}

export function getInstrument(symbol: string): InstrumentSpec | undefined {
  return BY_SYMBOL.get(normalizeSymbol(symbol));
}

export function formatPrice(value: number, instrument: InstrumentSpec | undefined): string {
  return value.toFixed(instrument?.pricePrecision ?? 5);
}
