/**
 * Zaif public trade API (api.zaif.jp/api/1/trades/xcp_jpy) — the LIVE leg of the deepest measured
 * XCP source (first-party XCP/JPY scored 0.032 median |ln err| vs CMC in the pricing audit). The
 * public endpoint returns the last 150 executions; XCP/JPY prints a handful of trades a day, so a
 * few polls a day cover the tape. Live rows are provisional: the authorized monthly CSV import
 * remains the authoritative record and overwrites them (distinct `method` labels keep that honest).
 */
export interface ZaifTrade {
  date: number; // unix seconds
  price: number; // JPY per XCP
  amount: number; // XCP
  tid: number;
}

export function parseZaifTrades(payload: unknown): ZaifTrade[] {
  if (!Array.isArray(payload)) throw new Error("Zaif trades response must be an array");
  return payload.map((row, index) => {
    const trade = row as Record<string, unknown>;
    const date = Number(trade.date);
    const price = Number(trade.price);
    const amount = Number(trade.amount);
    const tid = Number(trade.tid);
    if (!Number.isInteger(date) || date <= 0) throw new Error(`Zaif trade ${index} date is invalid`);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`Zaif trade ${index} price is invalid`);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Zaif trade ${index} amount is invalid`);
    if (!Number.isInteger(tid) || tid <= 0) throw new Error(`Zaif trade ${index} tid is invalid`);
    return { date, price, amount, tid };
  });
}

export async function fetchZaifTrades(pair = "xcp_jpy", fetcher: typeof fetch = fetch): Promise<ZaifTrade[]> {
  const response = await fetcher(`https://api.zaif.jp/api/1/trades/${pair}`, {
    headers: { accept: "application/json", "user-agent": "xcp.io-indexer" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Zaif trades request failed: ${response.status}`);
  return parseZaifTrades(await response.json());
}

/** Per-UTC-day volume-weighted median — the same statistic every other venue series uses. */
export function zaifDailyVwm(
  trades: ZaifTrade[],
): { day: string; price: number; volume: number; trades: number; firstTime: number; lastTime: number }[] {
  const byDay = new Map<string, ZaifTrade[]>();
  for (const trade of trades) {
    const day = new Date(trade.date * 1000).toISOString().slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(trade);
    else byDay.set(day, [trade]);
  }
  return [...byDay.entries()]
    .map(([day, rows]) => {
      const sorted = [...rows].sort((a, b) => a.price - b.price);
      const total = sorted.reduce((sum, row) => sum + row.amount, 0);
      let cumulative = 0;
      let median = sorted[sorted.length - 1]!.price;
      for (const row of sorted) {
        cumulative += row.amount;
        if (cumulative * 2 >= total) {
          median = row.price;
          break;
        }
      }
      return {
        day,
        price: median,
        volume: total,
        trades: rows.length,
        firstTime: Math.min(...rows.map((row) => row.date)),
        lastTime: Math.max(...rows.map((row) => row.date)),
      };
    })
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}
