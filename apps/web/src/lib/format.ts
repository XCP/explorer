// Small display helpers shared across explorer routes.
export const short = (s?: string, head = 8, tail = 6) =>
  !s ? "" : s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;

export const commas = (v?: string | number | null) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
};

export const ts = (sec?: number | null) =>
  sec ? new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—";
