/**
 * Year-in-review queries + the authored catalog behind GET /v2/years and /v2/years/:year.
 *
 * Two content classes, deliberately separated:
 *  - COMPUTED — every number comes from the SQL below over the mirror + derived signals. The
 *    per-year "ledger" functions scan once and GROUP BY year so the index and the year pages
 *    share one definition and can never disagree.
 *  - CURATED — YEARS_CATALOG holds authored editorial (titles, moments, graffiti, context,
 *    lexicon) distilled from docs/year-unwrapped.md. Only verified material ships here; no
 *    number in the catalog exists that a query doesn't also produce.
 *
 * "clean" everywhere means asset_signals.low_quality = 0 (wash/pump denylist + heuristics).
 */
import type {
  YearBurn,
  YearCard,
  YearCollection,
  YearEditorial,
  YearMonth,
  YearOhlc,
  YearProtocolEvent,
  YearSale,
  YearSettlement,
  YearTopAsset,
  YearVenue,
  YearZaif,
} from "@xcp/shared/years";
import { one, q } from "#api/db";

export const FIRST_YEAR = 2014;

export const yearStart = (year: number): number => Date.UTC(year, 0, 1) / 1000;
export const yearEnd = (year: number): number => Date.UTC(year + 1, 0, 1) / 1000;

/** Literal self-fills (buyer = seller) never count toward volume or sales — for ANY asset. Rows
 *  missing a party (dispenses, emblem) are real sales and stay. Kept as a per-alias fragment. */
const realTrade = (alias: string) =>
  `(${alias}.buyer_id IS NULL OR ${alias}.seller_id IS NULL OR ${alias}.buyer_id<>${alias}.seller_id)`;

/* ---------- all-year ledgers (single scans; shared by index + pages) ---------- */

export interface YearLedgerRow {
  y: string;
  [k: string]: string | number | null;
}

/** Transactions + distinct actors per year — the expensive full scan. */
export function yearActivityLedger(db: D1Database) {
  return q<{ y: string; transactions: number; actors: number }>(
    db,
    `SELECT strftime('%Y', block_time, 'unixepoch') y,
       COUNT(*) transactions, COUNT(DISTINCT source_id) actors
     FROM transactions WHERE block_time IS NOT NULL GROUP BY y`,
  );
}

/** Addresses whose first-ever Counterparty transaction fell in each year. */
export function yearNewcomerLedger(db: D1Database) {
  return q<{ y: string; newcomers: number }>(
    db,
    `SELECT strftime('%Y', mt, 'unixepoch') y, COUNT(*) newcomers
     FROM (SELECT source_id, MIN(block_time) mt FROM transactions GROUP BY source_id)
     GROUP BY y`,
  );
}

export function yearAssetLedger(db: D1Database) {
  return q<{ y: string; new_assets: number; issuers: number; subassets: number }>(
    db,
    `SELECT strftime('%Y', first_issuance_block_time, 'unixepoch') y,
       COUNT(*) new_assets, COUNT(DISTINCT issuer_id) issuers,
       SUM(asset_longname IS NOT NULL) subassets
     FROM assets WHERE first_issuance_block_time IS NOT NULL GROUP BY y`,
  );
}

export function yearRawDexLedger(db: D1Database) {
  return q<{ y: string; fills: number; usd: number }>(
    db,
    `SELECT strftime('%Y', trade.block_time, 'unixepoch') y,
       COUNT(*) fills, ROUND(COALESCE(SUM(trade.usd_value), 0)) usd
     FROM trades trade WHERE trade.venue='dex' AND trade.block_time IS NOT NULL
       AND ${realTrade("trade")} GROUP BY y`,
  );
}

export function yearCleanLedger(db: D1Database) {
  return q<{ y: string; fills: number; usd: number }>(
    db,
    `SELECT strftime('%Y', trade.block_time, 'unixepoch') y,
       COUNT(*) fills, ROUND(COALESCE(SUM(trade.usd_value), 0)) usd
     FROM trades trade LEFT JOIN asset_signals signal ON signal.asset_id=trade.asset_id
     WHERE trade.block_time IS NOT NULL AND COALESCE(signal.low_quality, 0)=0
       AND ${realTrade("trade")} GROUP BY y`,
  );
}

/** Yearly open/close/high/low for one currency in the reviewed USD price calendar. */
export function yearOhlcLedger(db: D1Database, currency: "XCP" | "BTC") {
  return q<{ y: string; open: number; close: number; high: number; low: number }>(
    db,
    `SELECT substr(price.day, 1, 4) y,
       (SELECT usd FROM prices p2 WHERE p2.currency=?1 AND substr(p2.day,1,4)=substr(price.day,1,4)
         ORDER BY p2.day LIMIT 1) open,
       (SELECT usd FROM prices p3 WHERE p3.currency=?1 AND substr(p3.day,1,4)=substr(price.day,1,4)
         ORDER BY p3.day DESC LIMIT 1) close,
       MAX(price.usd) high, MIN(price.usd) low
     FROM prices price WHERE price.currency=?1 AND price.day >= '2014-01-01'
     GROUP BY y`,
    currency, // ?1 is shared by the outer filter and both correlated subselects
  );
}

export const toOhlc = (row: { open: number; close: number; high: number; low: number } | undefined): YearOhlc | null =>
  row && row.open > 0
    ? {
        open: row.open,
        close: row.close,
        high: row.high,
        low: row.low,
        change_pct: Math.round(((row.close - row.open) / row.open) * 1000) / 10,
      }
    : null;

/* ---------- per-year detail ---------- */

export const YEAR_STATS_DETAIL_SQL = `WITH year_blocks AS MATERIALIZED (
  SELECT block_index FROM blocks INDEXED BY idx_blocks_time WHERE block_time>=?1 AND block_time<?2
)
SELECT
  (SELECT COUNT(*) FROM year_blocks CROSS JOIN sends INDEXED BY idx_sends_block
    ON sends.block_index=year_blocks.block_index) sends,
  (SELECT COUNT(*) FROM year_blocks CROSS JOIN issuances INDEXED BY idx_issuances_block
    ON issuances.block_index=year_blocks.block_index
    WHERE locked=1) supply_locks,
  (SELECT COUNT(*) FROM year_blocks CROSS JOIN issuances INDEXED BY idx_issuances_block
    ON issuances.block_index=year_blocks.block_index
    WHERE transfer=1) ownership_transfers`;

export function yearStatsDetail(db: D1Database, start: number, end: number) {
  return one<{ sends: number; supply_locks: number; ownership_transfers: number }>(
    db,
    YEAR_STATS_DETAIL_SQL,
    start,
    end,
  );
}

export function yearVenues(db: D1Database, start: number, end: number): Promise<YearVenue[]> {
  return q<YearVenue>(
    db,
    `SELECT trade.venue, COUNT(*) fills, ROUND(COALESCE(SUM(trade.usd_value), 0)) usd
     FROM trades trade LEFT JOIN asset_signals signal ON signal.asset_id=trade.asset_id
     WHERE trade.block_time>=?1 AND trade.block_time<?2 AND COALESCE(signal.low_quality, 0)=0
       AND ${realTrade("trade")}
     GROUP BY trade.venue ORDER BY usd DESC`,
    start,
    end,
  );
}

export function yearMonthly(db: D1Database, start: number, end: number): Promise<YearMonth[]> {
  return q<YearMonth>(
    db,
    `WITH RECURSIVE months(month) AS (SELECT 1 UNION ALL SELECT month+1 FROM months WHERE month<12),
     clean AS (
       SELECT CAST(strftime('%m', trade.block_time, 'unixepoch') AS INTEGER) month,
         COUNT(*) clean_fills, ROUND(COALESCE(SUM(trade.usd_value), 0)) clean_usd
       FROM trades trade LEFT JOIN asset_signals signal ON signal.asset_id=trade.asset_id
       WHERE trade.block_time>=?1 AND trade.block_time<?2 AND COALESCE(signal.low_quality, 0)=0
         AND ${realTrade("trade")}
       GROUP BY month
     ), mint AS (
       SELECT CAST(strftime('%m', first_issuance_block_time, 'unixepoch') AS INTEGER) month,
         COUNT(*) new_assets
       FROM assets WHERE first_issuance_block_time>=?1 AND first_issuance_block_time<?2
       GROUP BY month
     )
     SELECT months.month, COALESCE(clean.clean_fills, 0) clean_fills,
       COALESCE(clean.clean_usd, 0) clean_usd, COALESCE(mint.new_assets, 0) new_assets
     FROM months
     LEFT JOIN clean ON clean.month=months.month LEFT JOIN mint ON mint.month=months.month
     ORDER BY months.month`,
    start,
    end,
  );
}

/** What DEX fills settled IN — the "money" chapter. Fill counts are the raw tape, but a
 *  wash-flagged settling currency is excluded outright: a pump's pair must not headline as
 *  "the most-used money of the year" (2020's tape was led by exactly such a pair). */
export function yearSettlement(db: D1Database, start: number, end: number): Promise<YearSettlement[]> {
  return q<YearSettlement>(
    db,
    `SELECT trade.currency, COUNT(*) fills, ROUND(SUM(trade.usd_value)) usd
     FROM trades trade
     LEFT JOIN asset_dictionary dictionary ON dictionary.asset=trade.currency
     LEFT JOIN asset_signals signal ON signal.asset_id=dictionary.asset_id
     WHERE trade.venue='dex' AND trade.block_time>=?1 AND trade.block_time<?2
       AND trade.currency IS NOT NULL AND COALESCE(signal.low_quality, 0)=0
       AND ${realTrade("trade")}
     GROUP BY trade.currency ORDER BY fills DESC LIMIT 8`,
    start,
    end,
  );
}

export function yearTopAssets(db: D1Database, start: number, end: number): Promise<YearTopAsset[]> {
  return q<YearTopAsset>(
    db,
    `SELECT dictionary.asset, state.asset_longname,
       COUNT(*) fills, ROUND(SUM(trade.usd_value)) usd
     FROM trades trade
     JOIN asset_dictionary dictionary ON dictionary.asset_id=trade.asset_id
     LEFT JOIN assets state ON state.asset_id=trade.asset_id
     LEFT JOIN asset_signals signal ON signal.asset_id=trade.asset_id
     WHERE trade.block_time>=?1 AND trade.block_time<?2
       AND trade.usd_value IS NOT NULL AND COALESCE(signal.low_quality, 0)=0
       AND ${realTrade("trade")}
     GROUP BY trade.asset_id ORDER BY usd DESC LIMIT 10`,
    start,
    end,
  );
}

/** Biggest single clean fill of <=10 units by a collection member — "sale of the year". */
export function yearSaleOfYear(db: D1Database, start: number, end: number): Promise<YearSale | null> {
  return one<YearSale>(
    db,
    `SELECT dictionary.asset, ROUND(trade.usd_value) usd, date(trade.block_time, 'unixepoch') day,
       trade.currency, trade.venue, trade.quantity
     FROM trades trade
     JOIN asset_dictionary dictionary ON dictionary.asset_id=trade.asset_id
     JOIN entity_dictionary entity ON entity.entity_key=dictionary.asset AND entity.entity_type='asset'
     JOIN collection_membership_evidence evidence ON evidence.entity_id=entity.entity_id
     LEFT JOIN asset_signals signal ON signal.asset_id=trade.asset_id
     WHERE trade.block_time>=?1 AND trade.block_time<?2 AND trade.usd_value IS NOT NULL
       AND trade.quantity<=10 AND COALESCE(signal.low_quality, 0)=0
       AND ${realTrade("trade")}
     GROUP BY trade.venue, trade.ref
     ORDER BY trade.usd_value DESC LIMIT 1`,
    start,
    end,
  );
}

/** Biggest single clean fill by an asset with NO collection membership — the coins-and-currencies
 *  counterpart to the card sale. No quantity cap: currencies trade in size by nature. */
export function yearCurrencySale(db: D1Database, start: number, end: number): Promise<YearSale | null> {
  return one<YearSale>(
    db,
    `SELECT dictionary.asset, ROUND(trade.usd_value) usd, date(trade.block_time, 'unixepoch') day,
       trade.currency, trade.venue, trade.quantity
     FROM trades trade
     JOIN asset_dictionary dictionary ON dictionary.asset_id=trade.asset_id
     LEFT JOIN asset_signals signal ON signal.asset_id=trade.asset_id
     WHERE trade.block_time>=?1 AND trade.block_time<?2 AND trade.usd_value IS NOT NULL
       AND COALESCE(signal.low_quality, 0)=0
       AND ${realTrade("trade")}
       AND NOT EXISTS (
         SELECT 1 FROM entity_dictionary entity
         JOIN collection_membership_evidence evidence ON evidence.entity_id=entity.entity_id
         WHERE entity.entity_type='asset' AND entity.entity_key=dictionary.asset
       )
     ORDER BY trade.usd_value DESC LIMIT 1`,
    start,
    end,
  );
}

/** The founding sacrifice — rows exist only inside the 2014 burn window. */
export function yearBurn(db: D1Database, start: number, end: number): Promise<YearBurn | null> {
  return one<YearBurn>(
    db,
    `SELECT COUNT(*) burns, COUNT(DISTINCT source_id) burners,
       ROUND(SUM(CAST(burned AS REAL))/1e8, 1) btc_burned,
       ROUND(SUM(CAST(earned AS REAL))/1e8) xcp_earned,
       MIN(date(block_time, 'unixepoch')) first_day, MAX(date(block_time, 'unixepoch')) last_day
     FROM burns WHERE block_time>=?1 AND block_time<?2
     HAVING COUNT(*) > 0`,
    start,
    end,
  );
}

/** Collections by members first-issued inside the year. Membership evidence can adopt assets
 *  issued before a collection existed — pages carry that caveat rather than the query hiding it. */
export function yearCollections(db: D1Database, start: number, end: number): Promise<YearCollection[]> {
  return q<YearCollection>(
    db,
    `SELECT evidence.tag,
       COALESCE((SELECT json_extract(meta.meta, '$.collection') FROM tags meta
         WHERE meta.tag=evidence.tag AND json_valid(meta.meta)
           AND json_extract(meta.meta, '$.collection') IS NOT NULL LIMIT 1), evidence.tag) name,
       COUNT(DISTINCT evidence.entity_id) cards
     FROM collection_membership_evidence evidence
     JOIN entity_dictionary entity ON entity.entity_id=evidence.entity_id AND entity.entity_type='asset'
     JOIN asset_dictionary dictionary ON dictionary.asset=entity.entity_key
     JOIN assets state ON state.asset_id=dictionary.asset_id
     WHERE state.first_issuance_block_time>=?1 AND state.first_issuance_block_time<?2
     GROUP BY evidence.tag ORDER BY cards DESC LIMIT 8`,
    start,
    end,
  );
}

/** "Class of the year": most-traded cards among collection members first-issued in the year. */
export function yearCards(db: D1Database, start: number, end: number): Promise<YearCard[]> {
  return q<YearCard>(
    db,
    `SELECT dictionary.asset, ROUND(SUM(trade.usd_value)) usd, COUNT(*) fills, MIN(evidence.tag) tag
     FROM trades trade
     JOIN asset_dictionary dictionary ON dictionary.asset_id=trade.asset_id
     JOIN assets state ON state.asset_id=trade.asset_id
     JOIN entity_dictionary entity ON entity.entity_key=dictionary.asset AND entity.entity_type='asset'
     JOIN collection_membership_evidence evidence ON evidence.entity_id=entity.entity_id
     LEFT JOIN asset_signals signal ON signal.asset_id=trade.asset_id
     WHERE trade.block_time>=?1 AND trade.block_time<?2 AND trade.usd_value IS NOT NULL
       AND state.first_issuance_block_time>=?1 AND state.first_issuance_block_time<?2
       AND COALESCE(signal.low_quality, 0)=0
       AND ${realTrade("trade")}
     GROUP BY trade.asset_id ORDER BY usd DESC LIMIT 10`,
    start,
    end,
  );
}

export function yearXcpDaily(db: D1Database, year: number) {
  return q<{ day: string; usd: number }>(
    db,
    `SELECT day, ROUND(usd, 4) usd FROM prices
     WHERE currency='XCP' AND day>=?1 AND day<=?2 ORDER BY day`,
    `${year}-01-01`,
    `${year}-12-31`,
  );
}

/** PEPECASH first/last-month trade VWAP; null when either endpoint month is too thin to price. */
export async function yearPepecashVwap(
  db: D1Database,
  start: number,
  end: number,
): Promise<{ first_vwap: number; last_vwap: number; change_pct: number } | null> {
  const months = await q<{ m: string; vwap: number; fills: number }>(
    db,
    `SELECT strftime('%m', trade.block_time, 'unixepoch') m,
       SUM(trade.usd_value)/SUM(trade.quantity) vwap, COUNT(*) fills
     FROM trades trade JOIN asset_dictionary dictionary ON dictionary.asset_id=trade.asset_id
     WHERE dictionary.asset='PEPECASH' AND trade.block_time>=?1 AND trade.block_time<?2
       AND trade.usd_value IS NOT NULL AND trade.quantity>0
       AND ${realTrade("trade")}
     GROUP BY m ORDER BY m`,
    start,
    end,
  );
  const priced = months.filter((month) => month.fills >= 10 && month.vwap > 0);
  if (priced.length < 2) return null;
  const first = priced[0]!;
  const last = priced[priced.length - 1]!;
  return {
    first_vwap: Math.round(first.vwap * 1e5) / 1e5,
    last_vwap: Math.round(last.vwap * 1e5) / 1e5,
    change_pct: Math.round(((last.vwap - first.vwap) / first.vwap) * 1000) / 10,
  };
}

/** The attributable CEX lane (Zaif), normalized to USD through the reviewed BTC + ECB calendars. */
export function yearZaif(db: D1Database, year: number): Promise<YearZaif | null> {
  return one<YearZaif>(
    db,
    `SELECT COUNT(DISTINCT observation.day) days,
       ROUND(SUM(observation.volume_base)) xcp_volume,
       ROUND(SUM(CASE observation.quote_currency
         WHEN 'BTC' THEN observation.volume_base*observation.price
           *(SELECT usd FROM prices WHERE currency='BTC' AND day=observation.day)
         WHEN 'JPY' THEN observation.volume_base*observation.price
           *(SELECT price FROM market_price_observations WHERE source='ecb' AND venue='reference'
             AND base_currency='EUR' AND quote_currency='USD' AND day<=observation.day ORDER BY day DESC LIMIT 1)
           /(SELECT price FROM market_price_observations WHERE source='ecb' AND venue='reference'
             AND base_currency='EUR' AND quote_currency='JPY' AND day<=observation.day ORDER BY day DESC LIMIT 1)
         END)) usd
     FROM market_price_observations observation
     WHERE observation.venue='cex' AND observation.base_currency='XCP' AND observation.day LIKE ?1
     HAVING COUNT(*) > 0`,
    `${year}%`,
  );
}

/* ---------- the authored catalog ---------- */

/** Protocol activations per year — block heights from counterparty-core protocol_changes.json,
 *  dates resolved once against our blocks table (immutable, so stored as literals). */
const PROTOCOL: Record<number, YearProtocolEvent[]> = {
  2014: [
    { date: "2014-06-29", name: "RPS enabled", note: "Rock-paper-scissors on-chain — the gambling era's toybox." },
    {
      date: "2014-12-09",
      name: "Numeric assets + multisig",
      note: "Free A-number names arrive; the 2015 flood follows.",
    },
  ],
  2015: [{ date: "2015-04-13", name: "RPS disabled", note: "The gambling era quietly ends." }],
  2016: [{ date: "2016-08-06", name: "P2SH addresses", note: "3-addresses can use Counterparty." }],
  2017: [
    { date: "2017-05-21", name: "Subassets", note: "PARENT.CHILD names; 126 exist by New Year's." },
    { date: "2017-10-15", name: "Enhanced sends", note: "Short type IDs + memo sends land mid-mania." },
  ],
  2018: [],
  2019: [
    { date: "2019-01-06", name: "Segwit support", note: "Modern Bitcoin transactions become usable." },
    { date: "2019-07-15", name: "Dispensers + sweeps", note: "On-chain vending machines ship into the quietest year." },
  ],
  2020: [{ date: "2020-02-09", name: "MPMA sends", note: "Batch sends — infrastructure with nobody watching." }],
  2021: [],
  2022: [{ date: "2022-09-10", name: "Oracle dispensers (CIP03)", note: "USD-priced vending via signed price feeds." }],
  2023: [{ date: "2023-12-01", name: "Multiple dispenses", note: "Batch vending for the stamp era's throughput." }],
  2024: [
    {
      date: "2024-10-17",
      name: "Fairminters + UTXO support",
      note: "Block 866,000 — the biggest activation day since 2014; free subassets too.",
    },
  ],
  2025: [{ date: "2025-06-20", name: "Taproot + fairminter v2", note: "Modern tx formats; P2SH encoding retired." }],
  2026: [
    {
      date: "2026-06-08",
      name: "AMM pools + indefinite orders",
      note: "The DEX's first structural upgrade in a decade; ordinals metadata support.",
    },
  ],
};

export const YEARS_CATALOG: Record<number, YearEditorial> = {
  2014: {
    title: "The Burn",
    angle:
      "2,125.6 BTC destroyed by 2,354 addresses in one month bought a financial platform — and the first thing anyone built with it was a card table.",
    moments: [
      {
        label: "JAN 02",
        text: "The bitcointalk announcement and the first burn share a date: 'Counterparty aims to democratize finance.'",
      },
      {
        label: "FEB 02",
        text: "The burn closes: 2,125.6 BTC destroyed, 2,649,791 XCP born. Mt. Gox freezes withdrawals five days later.",
      },
      { label: "APR 13", text: "The first recorded card sale: POKEMON, $166, paid in BTC." },
      {
        label: "JUN 29",
        text: "Rock-paper-scissors goes live on-chain; 1,105 bets are placed this year — betting never has another year like it.",
      },
      { label: "OCT", text: "Overstock's Medici project sets out to build a licensed stock market on Counterparty." },
      { label: "DEC 09", text: "Numeric assets and multisig activate — the door the 2015 flood walks through." },
    ],
    graffiti: { day: "2014-09-23", text: "Will the price of gold rise by 12:00 AM UTC, Sep24? 1=yes, 2=no" },
    meanwhile: [
      "Mt. Gox collapsed weeks after the burn closed; Ethereum spent the summer selling ETH for BTC in its crowdsale — two funding philosophies, same year.",
      "XCP finished +646% in a year Bitcoin fell 59% — the biggest relative outperformance in the ledger.",
    ],
    lexicon: ["burn", "bets", "feeds", "faucet", "the DEX"],
  },
  2015: {
    title: "The Flood and the First Winter",
    angle:
      "36,552 names registered, 394 ever traded. The spam flood and the seeds — Spells of Genesis minting game cards years before ERC-721 — share one page.",
    moments: [
      { label: "APR 13", text: "RPS is disabled; the gambling era ends without a eulogy." },
      {
        label: "SPRING",
        text: "The flood: ~32 registrations per issuer after numeric names went cheap. 98.9% never trade once.",
      },
      { label: "YEAR", text: "Registration fees destroy a record 17,756 XCP — the flood at least paid rent." },
      { label: "SEP", text: "Spells of Genesis mints its first cards; FDCARD becomes the first game-card trade." },
      { label: "DEC", text: "Subassets are proposed on the forums — eighteen months before the protocol ships them." },
    ],
    graffiti: { day: "2015-11-23", text: "The block chain is the prison of truth. | Michel Foucault" },
    meanwhile: [
      "Ethereum's mainnet launched July 30 — the competitor arriving in Counterparty's worst year (XCP −85% while BTC recovered +37%).",
      "TEDDY, CUPCAKE and DINOSAUR — March 2015 names — would sleep six and a half years before waking as antiques in November 2021.",
    ],
    lexicon: ["the flood", "proof of burn", "SJCX", "colored coins"],
  },
  2016: {
    title: "The Frog Appears",
    angle:
      "Rare Pepe invents the meme economy in September — months before CryptoPunks — and PEPECASH becomes the most-traded thing on the chain.",
    moments: [
      {
        label: "MAY",
        text: "The forums debate running Ethereum's VM on Bitcoin (gas costs and killswitches). It never ships; the cards do.",
      },
      { label: "AUG 06", text: "P2SH addresses activate." },
      { label: "AUG 15", text: "SATOSHICARD sells for $3,712 — the first four-figure card sale." },
      { label: "SEP", text: "Rare Pepe begins: 497 cards certified in four months. PEPECASH is born at $0.00006." },
      { label: "H2", text: "Zaif lists XCP against yen — the start of ten unbroken years of Japanese prints." },
    ],
    graffiti: { day: "2016-08-20", text: "This is a test of the emergency broadcast system. ABC123" },
    meanwhile: [
      "Ethereum spent the summer hacking itself apart (The DAO, the ETH/ETC split) while the meme economy quietly started here.",
      "XCP bottomed at $0.48 — the cheapest it has ever been — then doubled into year end.",
    ],
    lexicon: ["rare pepes", "PEPECASH", "series", "cards", "kek"],
  },
  2017: {
    title: "The Mania Year",
    angle:
      "XCP ran 17× and outpaced Bitcoin itself; Japan carried the volume; and the most-used money on the DEX was a meme called PEPECASH.",
    moments: [
      { label: "JAN 28", text: "XCP breaks $3 after a year asleep under two dollars. The run begins." },
      { label: "MAY 21", text: "Subassets arrive — the first PARENT.CHILD name is issued; 126 exist by New Year's." },
      {
        label: "JUL 04",
        text: "Busiest day of the year: 680 trades — and MODERNPEPE takes sale of the year at $11,627, paid in PEPECASH.",
      },
      {
        label: "NOV",
        text: "The fee squeeze bites: 177 new assets all month against February's 1,225, as Bitcoin fees price out creation.",
      },
      { label: "DEC 19", text: "Year peak: XCP prints $36.33. The all-time high comes three weeks later — in 2018." },
    ],
    graffiti: { day: "2017-07-12", text: "Price goes up, Price goes down, Counterparty just keeps on working :)" },
    meanwhile: [
      "Zaif's yen books turned over 532,299 XCP ($12.1M) — the one exchange lane whose every fill we can still prove.",
      "In December CryptoKitties congested Ethereum the same weeks Bitcoin fees strangled Counterparty's mint — both chains choked on their own mania at once.",
    ],
    lexicon: ["pepe scientists", "PEPECASH-as-money", "locks", "hodl", "moon"],
  },
  2018: {
    title: "The Morning After",
    angle:
      "The actual all-time high — $88.93 in January — then a 93% fall. The scene's answer was games, and Japan's answer was to buy.",
    moments: [
      { label: "JAN 10", text: "XCP's true all-time high: $88.93. CLUBPEPE sells for $8,448 the same week." },
      { label: "JAN 13", text: "The Rare AF festival in NYC — mania's last party, three days after the top." },
      {
        label: "JUN",
        text: "A forum proposal to 're-open burn in perpetuity' — start the founding sacrifice again. It doesn't pass.",
      },
      {
        label: "H2",
        text: "Rare Pepe closes the book with its final cards; Mafia Wars and Bitcorn are born in the wreckage.",
      },
      {
        label: "DEC",
        text: "The year closes at $2.10, −93%. Zaif's yen books absorbed 1.66M XCP — their biggest year ever.",
      },
    ],
    graffiti: { day: "2018-12-16", text: "Kaleidoscope ASCII Asset Enhancement - Phase 1: Compression - completed" },
    meanwhile: [
      "ERC-721 was only finalized that January — the standard arrived after the scene it described.",
      "PEPECASH touched a dime in January (~1,650× from birth), then fell 97%.",
    ],
    lexicon: ["rekt", "hodl", "the book closes", "bitcorn"],
  },
  2019: {
    title: "The Vending Machine",
    angle:
      "In the quietest DEX year of the classic era, Counterparty shipped its biggest invention since the DEX itself: dispensers.",
    moments: [
      { label: "JAN 06", text: "Segwit support activates." },
      {
        label: "MAY",
        text: "CIP21 — dispensers — is debated on the forums; the Foundation election runs its nomination period.",
      },
      { label: "JUL 15", text: "Dispensers and sweeps activate. The first 23 dispenses move $648." },
      {
        label: "AUG 14",
        text: "Sale of the year: SATOSHICARD for $4,426 — paid in BITCRYSTALS, the winter's unit of account.",
      },
    ],
    graffiti: { day: "2019-06-30", text: "Official Nomination: Ryan Peters for Counterparty Foundation." },
    meanwhile: [
      "The outside consensus was 'crypto is dead'; DeFi was months old. On-chain NFT vending machines shipped two years before anyone said 'NFT summer'.",
      "XCP fell 35% while Bitcoin nearly doubled — the recovery skipped Counterparty.",
    ],
    lexicon: ["dispensers", "the Foundation", "BITCRYSTALS"],
  },
  2020: {
    title: "The Ghost Town",
    angle: "3,705 active addresses all year — the all-time low. The vending machines kept the lights on.",
    moments: [
      { label: "FEB 09", text: "MPMA batch sends activate — infrastructure, with nobody watching." },
      { label: "MAR 12", text: "The COVID crash: Bitcoin touches $4,857 in our calendar." },
      {
        label: "YEAR",
        text: "Dispensers reach parity with the DEX ($73k vs $79k clean) — the machines out-earn the market.",
      },
      {
        label: "LATE",
        text: "The first Emblem Vault fill: $18. The bridge that carries $90M next year enters as a rounding error.",
      },
    ],
    graffiti: { day: "2020-02-15", text: "How do i transfer Dollarcash crypto into my bank account?" },
    meanwhile: [
      "The cruelest split in the ledger: XCP −24% while Bitcoin did +304% and closed the year at its exact high. Crypto's biggest adoption year was Counterparty's emptiest room.",
    ],
    lexicon: ["bitcorn", "farming", "dispensers"],
  },
  2021: {
    title: "The Rediscovery",
    angle:
      "The NFT world found the original chain through a wrapper: the all-time money year — and the year the sleepers woke.",
    moments: [
      {
        label: "NOV 05",
        text: "UMBRELLA (born Nov 5, 2014) trades for the first time — seven years to the day. The chat coins 'historic NFT' the same week.",
      },
      {
        label: "NOV",
        text: "The March-2015 names — TEDDY, CUPCAKE, DINOSAUR — all wake within one week of each other.",
      },
      { label: "NOV 20", text: "PEPEMILLION: $896,411 in BTC — the biggest card sale in Counterparty history." },
      {
        label: "YEAR",
        text: "RAREPEPE does $8.06M across just 65 fills; Emblem carries $90.5M; Scarce City auctions $3.0M.",
      },
      { label: "SEP", text: "Fake Rares are born — the parody wave begins." },
    ],
    graffiti: { day: "2021-11-11", text: "This is a test transmission. You're a sexy …" },
    meanwhile: [
      "Beeple's $69M Christie's sale opened the year; XCP did +799% against Bitcoin's +57% — the biggest relative win since 2014.",
      "Only 10,939 newcomers arrived: the money 10×'d but the people didn't. 'gm', 'ser' and 'fren' enter the chat for the first time.",
    ],
    lexicon: ["gm", "ser", "fren", "historic NFTs", "vaults", "wrapped"],
  },
  2022: {
    title: "The Parody Renaissance",
    angle:
      "The all-time burn year: destruction became devotion while the outside market collapsed, and the fakes outgrew the originals.",
    moments: [
      { label: "JAN 30", text: "PEPEALASSAD sells for $682,224 in BTC." },
      {
        label: "APR 05",
        text: "An on-chain broadcast wishes Satoshi a happy birthday; another memorializes Loretta Lynn in the fall.",
      },
      { label: "SEP 10", text: "Oracle dispensers activate — USD-priced vending machines." },
      { label: "SEP 27", text: "HNFT Fest in Barcelona, with a 'rare pepe scientist dinner'." },
      {
        label: "YEAR",
        text: "5,179 destructions — PEPECASH burned 1,060 times as Fake Rare ritual; dispense fills hit their all-time record (50,966).",
      },
    ],
    graffiti: { day: "2022-04-05", text: "HAPPY BIRTHDAY SATOSHI, you changed the way we view the world." },
    meanwhile: [
      "Terra collapsed in May, FTX in November, NFT volumes fell ~90% — the underground threw a festival anyway.",
      "'Grail' enters the community lexicon this year; 'dank' peaks.",
    ],
    lexicon: ["grails", "dank", "fakes", "submissions", "burn rituals"],
  },
  2023: {
    title: "The Second Immigration",
    angle:
      "Ordinals lit Bitcoin's data layer on fire and Stamps chose Counterparty rails: all-time records in transactions, people and mints.",
    moments: [
      {
        label: "JAN",
        text: "Ordinals launches upstream; within weeks the chat's 'ordinals' mentions go from zero to hundreds.",
      },
      { label: "MAR", text: "Bitcoin Stamps chooses Counterparty; STAMPUNKS mints 9,999." },
      {
        label: "APR 14",
        text: "Someone puts 20.75 BTC ($632,728) into a dispenser for one WINKELPEPE — the most expensive vending-machine purchase in history.",
      },
      {
        label: "YEAR",
        text: "409,346 transactions from 63,818 addresses — 59,041 of them brand new. Bigger than 2017 on every people metric.",
      },
      { label: "DEC 01", text: "Multiple-dispense batching activates for the new throughput." },
    ],
    graffiti: { day: "2023-09-25", text: "Send me the 300 XCP you stole, motherfucker" },
    meanwhile: [
      "The broadcast layer — a sportsbook wire in 2014 — carried 70,399 messages this year as a minting rail: same message type, different civilization.",
      "The DEX shrank to $1.3M while Emblem did $22.0M: two economies sharing one chain.",
    ],
    lexicon: ["stamps", "ordinals", "SRC-20", "immigration"],
  },
  2024: {
    title: "The Protocol Rebuild",
    angle: "40 releases, 934 issues, and the biggest activation day since 2014 — then 204,621 fairmints in ten weeks.",
    moments: [
      { label: "JAN 12", text: "Governance by broadcast: 'I am J-Dog… and I support a fee on numeric assets.'" },
      { label: "APR", text: "The halving launches Runes upstream; the chat bets on an 'HNFT cycle' instead." },
      { label: "OCT 17", text: "Fairminters, UTXO support and free subassets activate together at block 866,000." },
      {
        label: "Q4",
        text: "MINTS closes at exactly 100,000 fairmints; PEPEFAIR draws 1,402 distinct minters — the most-participated mint ever.",
      },
      { label: "JUL 22", text: "RAREPEPE takes sale of the year at $176,019." },
    ],
    graffiti: {
      day: "2024-01-12",
      text: "I am J-Dog, developer of XChain and FreeWallet, and I support a fee on numeric assets",
    },
    meanwhile: [
      "Bitcoin ETFs in January, $100k crossed in December; XCP doubled ($4.11 → $7.28) — its only up-year since 2021. PEPECASH did +108%.",
      "More releases shipped in 2024 than in the previous ten years combined; the chat had its loudest year on record.",
    ],
    lexicon: ["fairmint", "runes", "UTXO", "wen"],
  },
  2025: {
    title: "The Long Tail",
    angle: "Record fill counts at record-low ticket sizes; the scene turned to writing its own history.",
    moments: [
      {
        label: "JAN 05",
        text: "SATOSHICARD takes sale of the year again — $54,090, its fourth title across a decade.",
      },
      {
        label: "JAN",
        text: "The HNFT historiography era: pioneer interviews, milestone graphics, Emblem research calls.",
      },
      { label: "JUN 20", text: "Taproot support and fairminter v2 activate; P2SH encoding is retired." },
      {
        label: "YEAR",
        text: "Emblem churns 71,622 fills for just $4.9M (~$69 a fill, against 2021's ~$5,968). Two drops — LOONEY and XCPFOLIO — mint 1,999 subassets.",
      },
    ],
    graffiti: { day: "2025-05-04", text: "Not your average art directory — thecounterp.art" },
    meanwhile: [
      "XCP bled −73% in a year Bitcoin merely drifted (−7% after a $124,720 high). The bleed was ours, not the market's.",
    ],
    lexicon: ["HNFTs", "the archive", "long tail"],
  },
  2026: {
    title: "The AMM Era",
    angle:
      "The DEX's first structural upgrade in a decade ships into a bear year; the mint is machines; the money arc reaches ETH.",
    moments: [
      { label: "JAN 11", text: "DARKPILLPEPE takes the early sale-of-year lead at $23,359 — settled in ETH, a first." },
      { label: "FEB 11", text: "A broadcast reads: 'an AI issued its first token today. block 936030.'" },
      { label: "JUN 08", text: "AMM pools, indefinite orders and ordinals metadata activate at block 952,800." },
      {
        label: "YTD",
        text: "Four wallets account for half the year's 9,423 registered assets — automated minting defines the year so far.",
      },
    ],
    graffiti: { day: "2026-02-11", text: "every satoshi a syllable, every block a breath" },
    meanwhile: [
      "A synchronized bear for once: XCP −26%, BTC −27% year-to-date. Zaif is still quoting XCP in yen — ten unbroken years.",
    ],
    lexicon: ["AMM", "pools", "rare pigeons"],
  },
};

export const yearProtocol = (year: number): YearProtocolEvent[] => PROTOCOL[year] ?? [];
