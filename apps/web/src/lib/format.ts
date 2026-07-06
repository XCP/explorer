// Small display helpers shared across explorer routes.
export const short = (s?: string | null, head = 8, tail = 6) =>
  !s ? "" : s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

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
