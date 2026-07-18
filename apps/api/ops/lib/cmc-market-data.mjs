/** Validate the exact CMC identity and daily USD fields consumed by the importer. */
export function parseCmcXcpQuotes(payload) {
  if (payload?.data?.id !== 132 || payload.data.symbol !== "XCP" || !Array.isArray(payload.data.quotes)) {
    throw new Error("CMC XCP history response shape changed");
  }
  const rows = payload.data.quotes.map((row) => {
    const day = String(row?.timestamp ?? "").slice(0, 10);
    const price = Number(row?.quote?.USD?.price);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(price) || price <= 0) {
      throw new Error("CMC XCP history contains an invalid observation");
    }
    return { day, price };
  });
  if (!rows.length || new Set(rows.map((row) => row.day)).size !== rows.length) {
    throw new Error("CMC XCP history is empty or contains duplicate days");
  }
  return rows;
}
