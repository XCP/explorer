const INDEX_ROOT = "https://zaif.jp/more_data";
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

/** Discover Zaif's first-party monthly execution CSVs for one market. */
export function parseZaifCsvIndex(html, pair) {
  if (!/^[a-z0-9_]+$/.test(pair)) throw new Error(`Invalid Zaif pair: ${pair}`);
  const base = `${INDEX_ROOT}/${pair}/csv.html`;
  const expected = new RegExp(`^${pair}_\\d{4}_\\d{2}\\.csv$`);
  const urls = [...html.matchAll(/href=["']([^"']+\.csv)["']/gi)]
    .map((match) => new URL(match[1], base))
    .filter((url) => expected.test(url.pathname.split("/").at(-1) ?? ""))
    .map(String);
  return [...new Set(urls)].sort();
}

/** Convert Zaif's timezone-less JST timestamp into an exact UTC epoch second. */
export function parseZaifTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(value);
  if (!match) throw new Error(`Invalid Zaif timestamp: ${value}`);
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - JST_OFFSET_MS;
  const roundTrip = new Date(utcMs + JST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
  if (roundTrip !== value.slice(0, 19)) throw new Error(`Invalid Zaif calendar timestamp: ${value}`);
  return Math.floor(utcMs / 1_000);
}

export function parseZaifTrades(csv, pair) {
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (!lines[0] || lines[0].trim() !== "timestamp,price,amount,trade_type") {
    throw new Error(`Unexpected Zaif ${pair} CSV header`);
  }
  const rows = [];
  for (const [index, line] of lines.slice(1).entries()) {
    if (!line.trim()) continue;
    const fields = line.split(",");
    if (fields.length !== 4) throw new Error(`Invalid Zaif ${pair} CSV row ${index + 2}`);
    const [timestamp, priceText, amountText, side] = fields;
    const price = Number(priceText);
    const amount = Number(amountText);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid Zaif ${pair} numeric row ${index + 2}`);
    }
    if (side !== "bid" && side !== "ask") throw new Error(`Invalid Zaif ${pair} side row ${index + 2}`);
    rows.push({ pair, time: parseZaifTimestamp(timestamp), price, amount, side });
  }
  return rows;
}

/** Daily volume-weighted median: the price containing the middle XCP of executed volume. */
export function aggregateZaifDaily(trades) {
  const groups = new Map();
  for (const trade of trades) {
    const day = new Date(trade.time * 1_000).toISOString().slice(0, 10);
    const group = groups.get(day) ?? [];
    group.push(trade);
    groups.set(day, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, rows]) => {
    rows.sort((a, b) => a.price - b.price);
    const volume = rows.reduce((sum, row) => sum + row.amount, 0);
    let cumulative = 0;
    const median = rows.find((row) => (cumulative += row.amount) * 2 >= volume);
    return {
      day,
      price: median.price,
      volumeXcp: volume,
      trades: rows.length,
      firstTime: Math.min(...rows.map((row) => row.time)),
      lastTime: Math.max(...rows.map((row) => row.time)),
    };
  });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchZaifHistory(pair, fetcher = fetch) {
  const indexUrl = `${INDEX_ROOT}/${pair}/csv.html`;
  const index = await fetcher(indexUrl);
  if (!index.ok) throw new Error(`Zaif ${pair} index failed: ${index.status}`);
  const urls = parseZaifCsvIndex(await index.text(), pair);
  if (!urls.length) throw new Error(`Zaif ${pair} index contained no CSV files`);
  const trades = [];
  const manifests = [];
  const fetchedAt = Math.floor(Date.now() / 1_000);
  for (let offset = 0; offset < urls.length; offset += 12) {
    const batch = await Promise.all(
      urls.slice(offset, offset + 12).map(async (url) => {
        const response = await fetcher(url);
        if (!response.ok) throw new Error(`Zaif CSV failed (${response.status}): ${url}`);
        const csv = await response.text();
        const rows = parseZaifTrades(csv, pair);
        return { rows, manifest: { url, sha256: await sha256(csv), rows: rows.length } };
      }),
    );
    for (const file of batch) {
      manifests.push(file.manifest);
      for (const row of file.rows) trades.push(row);
    }
  }
  return { pair, urls, manifests, fetchedAt, trades, daily: aggregateZaifDaily(trades) };
}
