import type { InstrumentSpec } from "@/shared/types/instrument";

/** ISO 4217 codes accepted as Forex legs. Any combination of two forms a valid symbol. */
const CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF",
  "TRY", "ZAR", "MXN", "SGD", "HKD", "CNH", "CNY", "ILS", "THB", "INR", "KRW", "BRL", "RON",
]);

/** Metals have their own contract sizes and pip conventions (these vary between brokers). */
const METALS: Record<string, { contractSize: number; pipSize: number; precision: number }> = {
  XAU: { contractSize: 100, pipSize: 0.1, precision: 2 },
  XAG: { contractSize: 5000, pipSize: 0.01, precision: 3 },
};

/** Quote currencies conventionally priced to 0.01 per pip. */
const TWO_DECIMAL_PIP = new Set(["JPY", "HUF", "KRW"]);

/**
 * Accepts "EUR/USD", "eurusd", "EUR-USD" or "EUR USD" and returns "EUR/USD".
 * Anything that is not two 3-letter codes is returned upper-cased and trimmed.
 */
export function normalizeSymbol(raw: string): string {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length === 6) return `${letters.slice(0, 3)}/${letters.slice(3)}`;
  return raw.trim().toUpperCase();
}

/**
 * Builds the contract specification from the symbol itself, so new pairs need
 * no code change: pip 0.01 when the quote is JPY (or similar), 0.0001 otherwise;
 * 100,000 units per lot; metals use their own contract.
 */
export function getInstrument(symbol: string): InstrumentSpec | undefined {
  const normalized = normalizeSymbol(symbol);
  const m = /^([A-Z]{3})\/([A-Z]{3})$/.exec(normalized);
  if (!m) return undefined;
  const [, base, quote] = m as unknown as [string, string, string];
  if (base === quote || !CURRENCIES.has(quote)) return undefined;

  const metal = METALS[base];
  if (metal) {
    return {
      symbol: normalized,
      displayName: normalized,
      assetClass: "METAL",
      base,
      quote,
      pipSize: metal.pipSize,
      pricePrecision: metal.precision,
      contractSize: metal.contractSize,
      minLot: 0.01,
      lotStep: 0.01,
    };
  }
  if (!CURRENCIES.has(base)) return undefined;
  const twoDecimal = TWO_DECIMAL_PIP.has(quote);
  return {
    symbol: normalized,
    displayName: normalized,
    assetClass: "FX",
    base,
    quote,
    pipSize: twoDecimal ? 0.01 : 0.0001,
    pricePrecision: twoDecimal ? 3 : 5,
    contractSize: 100_000,
    minLot: 0.01,
    lotStep: 0.01,
  };
}

/** Starting watchlist. Users add and remove symbols in Settings. */
export const DEFAULT_SYMBOLS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "AUD/USD", "USD/CAD", "NZD/USD", "EUR/GBP", "EUR/JPY", "GBP/JPY",
];

export function formatPrice(value: number, instrument: InstrumentSpec | undefined): string {
  return value.toFixed(instrument?.pricePrecision ?? 5);
}

/** Distance expressed in pips for this instrument. */
export function toPips(distance: number, instrument: InstrumentSpec): number {
  return Math.round((distance / instrument.pipSize) * 10) / 10;
}
