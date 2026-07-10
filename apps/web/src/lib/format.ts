// Small display helpers shared across explorer routes.
export const short = (s?: string | null, head = 8, tail = 6) =>
  !s ? "" : s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${tail > 0 ? s.slice(-tail) : ""}`;

export const commas = (v?: string | number | null) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
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
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
};

// Compact USD for money-stat surfaces ($114 / $3.4K / $1.2M) — dollar amounts where magnitude beats
// exactness. Sub-$1 keeps cents (small dispenser sales); $1+ rounds to whole dollars.
export const usdCompact = (v?: number | null) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + strip((v / 1e9).toFixed(1)) + "B";
  if (a >= 1e6) return "$" + strip((v / 1e6).toFixed(1)) + "M";
  if (a >= 1e3) return "$" + strip((v / 1e3).toFixed(1)) + "K";
  if (a >= 1) return "$" + Math.round(v).toLocaleString();
  if (a >= 0.01) return "$" + v.toFixed(2);
  // Sub-cent per-unit prices (cheap cards trade at fractions of a cent) — keep ~2 significant figures so
  // "$0.0030" doesn't collapse to a useless "$0.00".
  if (a > 0) return "$" + v.toFixed(Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(a)))));
  return "$0.00";
};

// Collection tags are slugs ("rare-pepe"); surfaces show them as display names ("Rare Pepe").
export const collectionLabel = (tag: string) =>
  tag.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

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
