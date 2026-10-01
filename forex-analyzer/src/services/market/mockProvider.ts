import type { Candle, MarketPrice } from "@/types/market";
import { TIMEFRAME_SECONDS, type Timeframe } from "@/types/trade";
import { getInstrument, normalizeSymbol } from "@/lib/instruments";
import { round } from "@/lib/math";
import { MarketDataError, type MarketDataProvider } from "./types";

interface MockProfile {
  basePrice: number;
  /** Typical daily move as a fraction of price. */
  dailyVol: number;
  /** Typical spread in price units. */
  spread: number;
}

/** Rough late-2026 price levels and behaviour. Invented data, for exploring the app only. */
const PROFILES: Record<string, MockProfile> = {
  EURUSD: { basePrice: 1.172, dailyVol: 0.0055, spread: 0.00006 },
  GBPUSD: { basePrice: 1.345, dailyVol: 0.0065, spread: 0.00009 },
  USDJPY: { basePrice: 148.2, dailyVol: 0.0065, spread: 0.008 },
  XAUUSD: { basePrice: 3850, dailyVol: 0.012, spread: 0.25 },
  AUDUSD: { basePrice: 0.662, dailyVol: 0.007, spread: 0.00008 },
  NZDUSD: { basePrice: 0.585, dailyVol: 0.0072, spread: 0.0001 },
  USDCAD: { basePrice: 1.382, dailyVol: 0.0045, spread: 0.0001 },
  USDCHF: { basePrice: 0.798, dailyVol: 0.0055, spread: 0.0001 },
  EURGBP: { basePrice: 0.8715, dailyVol: 0.0038, spread: 0.0001 },
  EURJPY: { basePrice: 173.7, dailyVol: 0.0068, spread: 0.015 },
  GBPJPY: { basePrice: 199.3, dailyVol: 0.0078, spread: 0.022 },
};

const BAR_SECONDS = 300; // the mock market is generated at M5 resolution and aggregated upwards
const BARS_PER_DAY = 86_400 / BAR_SECONDS;
/** Fixed origin so the same timestamp always produces the same price, across restarts. */
const ANCHOR_SECONDS = Date.UTC(2025, 0, 1) / 1000;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Activity by UTC hour: quiet Asia, busy London/New York overlap. */
function sessionVolFactor(hourUtc: number, jpy: boolean): number {
  if (hourUtc < 7) return jpy ? 0.9 : 0.6;
  if (hourUtc < 12) return 1.2;
  if (hourUtc < 17) return 1.4;
  if (hourUtc < 21) return 0.85;
  return 0.5;
}

class MockPath {
  open = new Float64Array(0);
  high = new Float64Array(0);
  low = new Float64Array(0);
  close = new Float64Array(0);
  length = 0;

  private readonly rand: () => number;
  private spareNormal: number | null = null;
  private price: number;
  private drift = 0;
  private regimeBarsLeft = 0;
  private volRegime = 1;

  constructor(
    readonly symbol: string,
    private readonly profile: MockProfile,
  ) {
    this.rand = mulberry32(hashString(symbol));
    this.price = profile.basePrice;
  }

  private normal(): number {
    if (this.spareNormal !== null) {
      const s = this.spareNormal;
      this.spareNormal = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.rand();
    const v = this.rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spareNormal = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  private grow(capacity: number): void {
    if (capacity <= this.open.length) return;
    const size = Math.max(capacity, Math.ceil(this.open.length * 1.5) + 1024);
    for (const key of ["open", "high", "low", "close"] as const) {
      const next = new Float64Array(size);
      next.set(this[key].subarray(0, this.length));
      this[key] = next;
    }
  }

  /** Generate bars up to and including index `last`. */
  extendTo(last: number): void {
    if (last < this.length) return;
    this.grow(last + 1);
    const { dailyVol, basePrice } = this.profile;
    const sigmaBar = dailyVol / Math.sqrt(BARS_PER_DAY);
    const reversion = Math.log(2) / (30 * BARS_PER_DAY); // ~30 day half-life back towards the base price
    const jpy = this.symbol.endsWith("JPY");

    for (let i = this.length; i <= last; i++) {
      if (this.regimeBarsLeft <= 0) {
        // A new trend/range regime every 1.5 to 6 days.
        this.regimeBarsLeft = Math.round(BARS_PER_DAY * (1.5 + this.rand() * 4.5));
        const r = this.rand();
        this.drift = r < 0.3 ? 0 : (this.rand() * 2 - 1) * 0.06 * sigmaBar;
      }
      this.regimeBarsLeft--;
      this.volRegime = Math.min(1.8, Math.max(0.6, this.volRegime * Math.exp(this.normal() * 0.01)));

      const hour = new Date((ANCHOR_SECONDS + i * BAR_SECONDS) * 1000).getUTCHours();
      const sigma = sigmaBar * sessionVolFactor(hour, jpy) * this.volRegime;
      const shock = this.rand() < 0.002 ? 4 : 1;
      const ret = this.drift - reversion * Math.log(this.price / basePrice) + sigma * this.normal() * shock;

      const o = this.price;
      const c = o * Math.exp(ret);
      const wick = () => Math.abs(this.normal()) * sigma * 0.6;
      this.open[i] = o;
      this.close[i] = c;
      this.high[i] = Math.max(o, c) * (1 + wick());
      this.low[i] = Math.min(o, c) * (1 - wick());
      this.price = c;
    }
    this.length = last + 1;
  }
}

export interface MockProviderOptions {
  now?: () => Date;
}

/**
 * Deterministic synthetic market for development and demos. Prices follow a
 * seeded random walk with trending regimes, volatility clustering and session
 * activity, generated at M5 and aggregated to higher timeframes so every
 * timeframe agrees. It trades 24/7 so the app can be explored any time.
 */
export class MockMarketDataProvider implements MarketDataProvider {
  readonly id = "mock";
  readonly name = "Mock market (synthetic)";
  readonly isMock = true;
  private readonly paths = new Map<string, MockPath>();
  private readonly now: () => Date;

  constructor(options: MockProviderOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  supportsTimeframe(timeframe: Timeframe): boolean {
    return timeframe in TIMEFRAME_SECONDS;
  }

  private path(pair: string): MockPath {
    const symbol = normalizeSymbol(pair);
    const profile = PROFILES[symbol];
    if (!profile) throw new MarketDataError("UNSUPPORTED_PAIR", `Mock data has no instrument "${pair}".`);
    let path = this.paths.get(symbol);
    if (!path) {
      path = new MockPath(symbol, profile);
      this.paths.set(symbol, path);
    }
    return path;
  }

  /** Bar index containing `nowSec`, and how far through that bar we are (0..1). */
  private cursor(nowSec: number): { index: number; progress: number } {
    const offset = nowSec - ANCHOR_SECONDS;
    if (offset < 0) throw new MarketDataError("UNAVAILABLE", "Mock clock is before the start of the synthetic history.");
    const index = Math.floor(offset / BAR_SECONDS);
    return { index, progress: (offset - index * BAR_SECONDS) / BAR_SECONDS };
  }

  /** OHLC of one M5 bar; the forming bar is revealed progressively so the price moves within it. */
  private bar(path: MockPath, i: number, current: number, progress: number, nowSec: number): Candle {
    const time = ANCHOR_SECONDS + i * BAR_SECONDS;
    const o = path.open[i]!;
    const h = path.high[i]!;
    const l = path.low[i]!;
    const c = path.close[i]!;
    if (i < current) return { time, open: o, high: h, low: l, close: c };
    const wiggle = (mulberry32(hashString(`${path.symbol}:${Math.floor(nowSec / 2)}`))() - 0.5) * (h - l) * 0.3;
    const price = Math.min(h, Math.max(l, o + (c - o) * progress + wiggle * Math.sin(Math.PI * progress)));
    return {
      time,
      open: o,
      high: Math.max(o, price) + (h - Math.max(o, c)) * progress,
      low: Math.min(o, price) - (Math.min(o, c) - l) * progress,
      close: price,
    };
  }

  async getCandles(pair: string, timeframe: Timeframe, limit: number): Promise<Candle[]> {
    if (!this.supportsTimeframe(timeframe)) {
      throw new MarketDataError("UNSUPPORTED_TIMEFRAME", `Timeframe ${timeframe} is not supported.`);
    }
    const path = this.path(pair);
    const instrument = getInstrument(pair);
    const precision = instrument?.pricePrecision ?? 5;
    const nowSec = Math.floor(this.now().getTime() / 1000);
    const { index: current, progress } = this.cursor(nowSec);
    path.extendTo(current);

    const tfSec = TIMEFRAME_SECONDS[timeframe];
    const barsPer = tfSec / BAR_SECONDS;
    const lastStart = Math.floor(nowSec / tfSec) * tfSec;
    const out: Candle[] = [];
    for (let k = limit - 1; k >= 0; k--) {
      const start = lastStart - k * tfSec;
      const first = (start - ANCHOR_SECONDS) / BAR_SECONDS;
      if (first < 0) continue;
      const last = Math.min(first + barsPer - 1, current);
      let open = 0;
      let high = -Infinity;
      let low = Infinity;
      let close = 0;
      for (let i = first; i <= last; i++) {
        const b = this.bar(path, i, current, progress, nowSec);
        if (i === first) open = b.open;
        high = Math.max(high, b.high);
        low = Math.min(low, b.low);
        close = b.close;
      }
      out.push({
        time: start,
        open: round(open, precision),
        high: round(high, precision),
        low: round(low, precision),
        close: round(close, precision),
      });
    }
    return out;
  }

  async getCurrentPrice(pair: string): Promise<MarketPrice> {
    const symbol = normalizeSymbol(pair);
    const path = this.path(symbol);
    const profile = PROFILES[symbol]!;
    const precision = getInstrument(symbol)?.pricePrecision ?? 5;
    const now = this.now();
    const nowSec = Math.floor(now.getTime() / 1000);
    const { index, progress } = this.cursor(nowSec);
    path.extendTo(index);
    const mid = this.bar(path, index, index, progress, nowSec).close;

    const hour = now.getUTCHours();
    const rollover = hour === 21 || hour === 22 ? 2.5 : 1;
    const asia = hour < 7 && !symbol.endsWith("JPY") ? 1.3 : 1;
    const jitter = 1 + (mulberry32(hashString(`${symbol}:spread:${Math.floor(nowSec / 10)}`))() - 0.5) * 0.4;
    const spread = profile.spread * rollover * asia * jitter;
    const bid = round(mid - spread / 2, precision);
    const ask = round(mid + spread / 2, precision);

    return {
      pair: symbol,
      price: round(mid, precision),
      bid,
      ask,
      spread: round(ask - bid, precision + 1),
      timestamp: now.getTime(),
      source: this.id,
    };
  }
}
