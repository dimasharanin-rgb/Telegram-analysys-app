const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

export function formatMoney(amount: number, currency = "USD", opts: { sign?: boolean } = {}): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const abs = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const neg = amount < 0 && Math.abs(amount) >= 0.005;
  const sign = neg ? "-" : opts.sign && amount > 0 ? "+" : "";
  return `${sign}${symbol}${abs}`;
}

export function formatPct(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatLots(lots: number): string {
  return `${lots.toFixed(2)} lots`;
}

export function formatRR(rr: number): string {
  return `1 : ${rr.toFixed(2)}`;
}

export function formatPips(pips: number): string {
  return `${pips.toFixed(1)} pips`;
}
