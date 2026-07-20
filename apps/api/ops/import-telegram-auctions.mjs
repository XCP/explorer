/** Conservative import of completed, priced Telegram auction lots. Without --apply, prints a census. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { executeRemoteD1 } from "./lib/remote-d1.mjs";
const args = process.argv.slice(2),
  apply = args.includes("--apply"),
  inputs = args.filter((x) => x !== "--apply");
if (!inputs.length) throw new Error("Provide Telegram result.json files");
const plain = (t) =>
  (Array.isArray(t) ? t.map((x) => (typeof x === "string" ? x : x.text || "")).join("") : String(t || ""))
    .replace(/\s+/g, " ")
    .trim();
const epoch = (d) => Math.floor(Date.parse(d) / 1000),
  q = (v) => `'${String(v).replaceAll("'", "''")}'`,
  num = (v) => Number(String(v).replaceAll(",", ""));
const roomUrl = (name) =>
  name === "Bidding Room"
    ? "https://t.me/nftauctions"
    : name === "Dank Auction House"
      ? "https://t.me/+FLLoyBuoWSgwN2Y0"
      : name === "BITCORN"
        ? "https://t.me/bitcorns"
        : name.includes("OUTBACK AUCTIONS")
          ? "https://t.me/OUTBACKAUCTIONS"
          : null;
function payment(s) {
  for (const [re, c] of [
    [/\$\s*([\d,.]+)|([\d,.]+)\s*(?:USD|USDC|dollars?)\b/i, "USD"],
    [/£\s*([\d,.]+)|([\d,.]+)\s*GBP\b/i, "GBP"],
    [/€\s*([\d,.]+)|([\d,.]+)\s*EUR\b/i, "EUR"],
    [/([\d,.]+)\s*(?:BTC|bitcoin)\b/i, "BTC"],
    [/([\d,.]+)\s*XCP\b/i, "XCP"],
    [/([\d,.]+)\s*ETH\b/i, "ETH"],
    [/([\d,.]+)\s*DOGE\b/i, "DOGE"],
    [/([\d,.]+)\s*PEPECASH\b/i, "PEPECASH"],
    [/([\d,.]+)\s*BITCORN\b/i, "BITCORN"],
  ]) {
    const m = s.match(re),
      v = m ? num(m[1] ?? m[2]) : NaN;
    if (Number.isFinite(v) && v > 0) return { currency: c, total: v };
  }
  return null;
}
function candidates(s) {
  const out = [];
  for (const m of s.matchAll(/(?:tokenscan\.io|xchain\.io|pepe\.wtf)\/asset\/([A-Za-z0-9._-]+)/gi))
    out.push({ asset: decodeURIComponent(m[1]).toUpperCase(), quantity: 1 });
  const x = s.match(/^([A-Za-z][A-Za-z0-9.]{2,40})(?:\s*[xX]\s*(\d+))?$/);
  if (x) out.push({ asset: x[1].toUpperCase(), quantity: Number(x[2] || 1) });
  const y = s.match(/^(?:LOT\s*#?\d+\s*[-:–—]?\s*)?([A-Z][A-Z0-9.]{2,40})(?:\s+[xX]\s*(\d+))?\b/);
  if (y) out.push({ asset: y[1], quantity: Number(y[2] || 1) });
  return out;
}
function legs(parts) {
  if (
    !parts.some((part) =>
      /(?:tokenscan\.io|xchain\.io|pepe\.wtf)\/asset\/|\b(?:series|issuance|inspect|directory|supply|card)\b/i.test(
        part,
      ),
    )
  )
    return [];
  const map = new Map();
  for (const part of parts)
    for (const leg of candidates(part)) {
      if (["LOT", "SOLD", "START", "HIDDEN", "CURRENT", "DANK", "RARE", "MIXED", "FIVE"].includes(leg.asset)) continue;
      const old = map.get(leg.asset);
      map.set(leg.asset, { asset: leg.asset, quantity: Math.max(old?.quantity || 0, leg.quantity || 1) });
    }
  return [...map.values()];
}
function bitcornLegs(text) {
  const head = text.split(/\b(?:TOTAL\s+SUPPLY|ISSUANCE|CARD\s+BY|STARTING\s+BID)\b/i)[0];
  const out = [];
  for (const match of head.matchAll(/(?:^|[,:]\s*|\s)([\d,]+)\s*(?:x\s*)?([A-Z][A-Z0-9.]{2,40})\b/g)) {
    if (match[2] !== "LOT") out.push({ asset: match[2], quantity: num(match[1]) });
  }
  return out;
}
function bitcornBid(text, priorHigh) {
  const match = text.match(/(?:^|\b(?:SOLD(?:\s+FOR)?|GOING|TO)\s+)([\d,.]+)\s*([kK])?\b/);
  if (!match) return null;
  let value = num(match[1]) * (match[2] ? 1000 : 1);
  // Live bidders commonly shortened 35,000 BITCORN to “35” once bidding was in the thousands.
  if (!match[2] && value < 100 && priorHigh >= 1000) value *= 1000;
  return value > 0 ? value : null;
}
function parseBitcorn(json) {
  const sales = [];
  let active = null;
  for (const message of json.messages || []) {
    const text = plain(message.text);
    const lot = text.match(/^(?:LOT\s*#?(\d+)\b\s*:?\s*|SURPRISE\s+LOT\s*:?\s*)/i);
    if (lot) {
      active = { number: lot[1] ? Number(lot[1]) : null, text, legs: bitcornLegs(text), high: 0 };
      continue;
    }
    if (!active) continue;
    const bid = bitcornBid(text, active.high);
    if (bid != null) active.high = Math.max(active.high, bid);
    if (/\bSOLD\b/i.test(text)) {
      if (active.high > 0 && active.legs.length)
        sales.push({
          message,
          pay: { currency: "BITCORN", total: active.high },
          lot: active.number,
          legs: active.legs,
          evidence: `${active.text} || high bid ${active.high} BITCORN || ${text}`,
        });
      active = null;
    }
  }
  return sales;
}
function parseOutback(json) {
  const sales = [],
    active = new Map();
  for (const message of json.messages || []) {
    const text = plain(message.text),
      seller = message.from || "";
    if (!text) continue;
    const found = [];
    for (const match of text.matchAll(
      /(?<!dogeparty\.)(?:tokenscan\.io|xchain\.io|pepe\.wtf)\/asset\/([A-Za-z0-9._-]+)/gi,
    ))
      found.push({ asset: decodeURIComponent(match[1]).toUpperCase(), quantity: 1 });
    if (found.length) active.set(seller, { at: epoch(message.date), text, legs: found });
    if (/^PASS(?:ED)?\b/i.test(text)) {
      active.delete(seller);
      continue;
    }
    if (!/^SOLD\s+(?:TO\b|FOR\b)/i.test(text)) continue;
    const pay = payment(text),
      def = active.get(seller);
    if (pay && def && epoch(message.date) - def.at <= 3600) {
      sales.push({ message, pay, lot: null, legs: def.legs, evidence: `${def.text} || ${text}` });
      active.delete(seller);
    }
  }
  return sales;
}
function parse(buffer) {
  const json = JSON.parse(buffer.toString("utf8")),
    lots = new Map(),
    sales = [];
  if (json.name === "BITCORN") return { json, sales: parseBitcorn(json) };
  if (json.name.includes("OUTBACK AUCTIONS")) return { json, sales: parseOutback(json) };
  let collecting = null,
    active = null;
  for (const message of json.messages || []) {
    const text = plain(message.text);
    if (!text) continue;
    const sold = text.match(/^LOT\s*#?(\d+)\s+SOLD\b/i);
    if (sold) {
      const pay = payment(text),
        number = Number(sold[1]),
        at = epoch(message.date),
        def = [...(lots.get(number) || [])].reverse().find((x) => at - x.at < 30 * 86400 && legs(x.parts).length);
      if (pay && def)
        sales.push({
          message,
          pay,
          lot: number,
          legs: legs(def.parts),
          evidence: `${def.parts.join(" | ")} || ${text}`,
        });
      continue;
    }
    if (/^(?:SOLD|CONGRATS|WINNER)\b/i.test(text) && json.name === "Bidding Room" && active) {
      const bid = active.bids.length ? Math.max(...active.bids) : NaN,
        pay = payment(text) || (Number.isFinite(bid) ? { currency: active.currency || "USD", total: bid } : null);
      if (pay)
        sales.push({
          message,
          pay,
          lot: active.number,
          legs: legs(active.parts),
          evidence: `${active.parts.join(" | ")} || high bid ${bid} || ${text}`,
        });
      active = null;
      continue;
    }
    if (json.name === "Bidding Room" && /\bAUCTION ENDS\b/i.test(text) && legs([text]).length) {
      active = {
        number: null,
        parts: [text],
        at: epoch(message.date),
        owner: message.from || null,
        bids: [],
        currency: "USD",
      };
      continue;
    }
    const mark = text.match(/^LOT\s*#?(\d+)\b(?!\s+SOLD)/i);
    if (mark && !/\bPASS(?:ED)?\b/i.test(text)) {
      const number = Number(mark[1]);
      collecting = { number, parts: [text], at: epoch(message.date), owner: message.from || null };
      const history = lots.get(number) || [];
      history.push(collecting);
      lots.set(number, history);
      active = {
        ...collecting,
        bids: [],
        currency: payment(text)?.currency || (/NO RESERVE/i.test(text) ? "USD" : null),
      };
      continue;
    }
    if (
      collecting &&
      epoch(message.date) - collecting.at < 300 &&
      (message.from || null) === collecting.owner &&
      !/^LOT\b/i.test(text)
    )
      collecting.parts.push(text);
    if (active) {
      if (/\bPASS(?:ED)?\b/i.test(text)) active = null;
      else {
        const m = text.match(/^\$?\s*([\d,.]+)\s*$/),
          v = m ? num(m[1]) : NaN;
        if (Number.isFinite(v) && v > 0) active.bids.push(v);
      }
    }
  }
  return { json, sales };
}
const parsed = inputs.map((file) => {
  const buffer = readFileSync(file);
  return { file, sha256: createHash("sha256").update(buffer).digest("hex"), ...parse(buffer) };
});
const all = [...new Set(parsed.flatMap((s) => s.sales.flatMap((x) => x.legs.map((l) => l.asset))))],
  valid = new Set();
for (let i = 0; i < all.length; i += 300) {
  const list = all
    .slice(i, i + 300)
    .map(q)
    .join(",");
  for (const row of executeRemoteD1(`SELECT asset FROM asset_dictionary WHERE asset IN (${list})`).rows)
    valid.add(row.asset);
}
for (const source of parsed) for (const sale of source.sales) sale.legs = sale.legs.filter((l) => valid.has(l.asset));
const admitted = parsed.flatMap((source) => source.sales.filter((x) => x.legs.length).map((x) => ({ source, ...x })));
console.log(
  JSON.stringify(
    {
      apply,
      files: parsed.map((s) => ({
        file: s.file,
        chat: s.json.name,
        messages: s.json.messages.length,
        candidates: s.sales.length,
        admitted: s.sales.filter((x) => x.legs.length).length,
      })),
      sales: admitted.length,
      single: admitted.filter((x) => x.legs.length === 1).length,
      bundles: admitted.filter((x) => x.legs.length > 1).length,
      max_legs: Math.max(0, ...admitted.map((x) => x.legs.length)),
      currencies: Object.fromEntries(
        [...new Set(admitted.map((x) => x.pay.currency))].map((c) => [
          c,
          admitted.filter((x) => x.pay.currency === c).length,
        ]),
      ),
      largest_bundles: admitted
        .sort((a, b) => b.legs.length - a.legs.length)
        .slice(0, 5)
        .map((x) => ({
          chat: x.source.json.name,
          message_id: x.message.id,
          legs: x.legs.map((l) => l.asset),
          total: x.pay,
        })),
    },
    null,
    2,
  ),
);
if (!apply) process.exit(0);
for (const source of parsed) {
  const ms = source.json.messages,
    url = roomUrl(source.json.name);
  executeRemoteD1(
    `INSERT INTO telegram_imports VALUES(${q(source.sha256)},${q(String(source.json.id))},${q(source.json.name)},${url ? q(url) : "NULL"},${ms.length ? epoch(ms[0].date) : "NULL"},${ms.length ? epoch(ms.at(-1).date) : "NULL"},${ms.length},unixepoch()) ON CONFLICT(sha256) DO UPDATE SET imported_at=excluded.imported_at,chat_url=excluded.chat_url`,
  );
}
for (let i = 0; i < admitted.length; i += 3) {
  const sql = [];
  for (const sale of admitted.slice(i, i + 3)) {
    const chat = String(sale.source.json.id),
      id = sale.message.id,
      ref = `${chat}:${id}`,
      cls = sale.legs.length > 1 ? "bundle" : "single",
      buyer = (sale.message.text_entities || []).find((e) => e.type === "mention")?.text || null;
    sql.push(
      `INSERT INTO telegram_sales VALUES(${q(chat)},${id},${q(sale.source.json.name)},${epoch(sale.message.date)},${q(sale.pay.currency)},${sale.pay.total},${buyer ? q(buyer) : "NULL"},${sale.message.from ? q(sale.message.from) : "NULL"},${sale.lot ?? "NULL"},${q(cls)},${q(sale.evidence.slice(0, 4000))},${q(sale.source.sha256)}) ON CONFLICT(chat_id,message_id) DO UPDATE SET currency=excluded.currency,total=excluded.total,sale_class=excluded.sale_class,evidence=excluded.evidence,import_sha256=excluded.import_sha256`,
      `DELETE FROM telegram_sale_legs WHERE chat_id=${q(chat)} AND message_id=${id}`,
    );
    sale.legs.forEach((l, n) =>
      sql.push(`INSERT INTO telegram_sale_legs VALUES(${q(chat)},${id},${n},${q(l.asset)},${l.quantity || 1})`),
    );
    sql.push(
      `INSERT INTO trades(venue,ref,asset_id,block_time,block_index,quantity,currency,total,usd_value,sale_class) SELECT 'telegram',${q(ref)},CASE WHEN ${sale.legs.length}=1 THEN (SELECT asset_id FROM asset_dictionary WHERE asset=${q(sale.legs[0].asset)}) END,${epoch(sale.message.date)},0,CASE WHEN ${sale.legs.length}=1 THEN ${sale.legs[0].quantity || 1} END,${q(sale.pay.currency)},${sale.pay.total},${sale.pay.currency === "USD" ? sale.pay.total : "NULL"},${q(cls)} ON CONFLICT(venue,ref) DO UPDATE SET asset_id=excluded.asset_id,block_time=excluded.block_time,quantity=excluded.quantity,currency=excluded.currency,total=excluded.total,usd_value=excluded.usd_value,sale_class=excluded.sale_class`,
      `DELETE FROM trade_legs WHERE venue='telegram' AND trade_ref=${q(ref)}`,
    );
    sale.legs.forEach((l, n) =>
      sql.push(
        `INSERT INTO trade_legs SELECT 'telegram',${q(ref)},${n},asset_id,${l.quantity || 1} FROM asset_dictionary WHERE asset=${q(l.asset)}`,
      ),
    );
  }
  executeRemoteD1(sql.join(";"));
}
