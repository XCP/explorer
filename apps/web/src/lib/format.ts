// Small display helpers shared across explorer routes.
export const short = (s?: string | null, head = 8, tail = 6) =>
  !s ? "" : s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${tail > 0 ? s.slice(-tail) : ""}`;

// The current interface is English. SSR and browsers must use the same explicit locale.
// Currency is separate: historical valuations remain USD, never relabelled by browser region.
export const DEFAULT_NUMBER_LOCALE = "en-US";
export const DEFAULT_FIAT_CURRENCY = "USD";

/** Intl accepts decimal strings exactly; TypeScript's older signature only names number/bigint. */
const formatDecimal = (value: string | number, options: Intl.NumberFormatOptions, locale: string) => {
  const formatter = new Intl.NumberFormat(locale, options);
  return (formatter.format as (value: string | number) => string)(value);
};

/** Expand a finite numeric display value without rounding away tiny fractions. */
const decimalText = (value: string | number): string => {
  const text = String(value);
  const scientific = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text);
  if (!scientific) return text;
  const [, sign, whole, fraction = "", exponent] = scientific;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  return (
    sign +
    (point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`)
  );
};

export const commas = (v?: string | number | null, locale = DEFAULT_NUMBER_LOCALE) => {
  if (v == null || v === "") return "—";
  if (!Number.isFinite(Number(v))) return String(v);
  return formatDecimal(v, { maximumFractionDigits: 8 }, locale);
};

// Exact protocol quantities use the asset's own scale. Preserve string precision before formatting;
// unknown values and fractional indivisible quantities must not become different rounded amounts.
export const amount = (
  v?: string | number | null,
  divisible: boolean | 0 | 1 = true,
  locale = DEFAULT_NUMBER_LOCALE,
) => {
  if (v == null || v === "") return "—";
  const text = typeof v === "number" ? decimalText(v) : v;
  const dp = divisible ? 8 : 0;
  if (!/^-?\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(v))) return "—";
  const fractional = text.split(".")[1]?.replace(/0+$/, "") ?? "";
  if (fractional.length > dp) return "—";
  if (typeof v === "number" && Number.isInteger(v) && !Number.isSafeInteger(v)) return "—";
  return formatDecimal(v, { minimumFractionDigits: dp, maximumFractionDigits: dp }, locale);
};

/** Raw ledger integer to canonical display/input text, without Number or an assumed asset scale. */
export const fromSatsExact = (v?: string | number | null, divisible: boolean | 0 | 1 = true): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number" && (!Number.isSafeInteger(v) || v < 0)) return null;
  if (!/^[0-9]+$/.test(String(v))) return null;
  const digits = BigInt(v).toString();
  if (!divisible) return digits;
  const padded = digits.padStart(9, "0");
  const fraction = padded.slice(-8).replace(/0+$/, "");
  return `${padded.slice(0, -8)}${fraction ? `.${fraction}` : ""}`;
};

// Compact large COUNTS/caps (1.2K, 3.4M, 5.6B, 7.8T) — for count-like columns where exactness isn't essential.
// Values below 100k keep full grouping (explorer users usually want exact small counts). Not for quantities.
const strip = (s: string) => s.replace(/\.0+$/, "");
export const compact = (v?: string | number | null) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  const a = Math.abs(n);
  if (a >= 1e12) return strip((n / 1e12).toFixed(2)) + "T";
  if (a >= 1e9) return strip((n / 1e9).toFixed(2)) + "B";
  if (a >= 1e6) return strip((n / 1e6).toFixed(2)) + "M";
  if (a >= 1e5) return strip((n / 1e3).toFixed(1)) + "K";
  return n.toLocaleString(DEFAULT_NUMBER_LOCALE, { maximumFractionDigits: 8 });
};

// Compact USD for money-stat surfaces ($114 / $3.4K / $1.2M) — dollar amounts where magnitude beats
// exactness. Sub-$1 keeps cents (small dispenser sales); $1+ rounds to whole dollars.
export const usdCompact = (v?: number | null) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + strip((v / 1e9).toFixed(1)) + "B";
  if (a >= 1e6) return "$" + strip((v / 1e6).toFixed(1)) + "M";
  if (a >= 1e3) return "$" + strip((v / 1e3).toFixed(1)) + "K";
  if (a >= 1) return "$" + Math.round(v).toLocaleString(DEFAULT_NUMBER_LOCALE);
  if (a >= 0.01) return "$" + v.toFixed(2);
  // Sub-cent per-unit prices (cheap cards trade at fractions of a cent) — keep ~2 significant figures so
  // "$0.0030" doesn't collapse to a useless "$0.00".
  if (a > 0) return "$" + v.toFixed(Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(a)))));
  return "$0.00";
};

// Collection tags are slugs ("rare-pepe"); surfaces show them as display names ("Rare Pepe").
export const collectionLabel = (tag: string) =>
  tag
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

// Raw protocol quantity → human units: divide by 1e8 only when divisible (R7 — never render raw
// satoshi fields). Default divisible=true covers the always-divisible XCP/BTC fields.
export const fromSats = (v?: string | number | null, divisible: boolean | 0 | 1 = true): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return null;
  return divisible ? n / 1e8 : n;
};

export const ts = (sec?: number | null) =>
  sec ? new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—";

// Relative "time ago" for freshness-first surfaces (the home "now" feeds) — coarse buckets, terse.
export const timeAgo = (sec?: number | null) => {
  if (!sec) return "—";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - sec));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};
