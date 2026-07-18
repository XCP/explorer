const ECB_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+JPY.EUR.SP00.A?startPeriod=2014-01-01&format=csvdata";

export function parseEcbReferenceRates(csv) {
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const header = lines[0]?.split(",");
  const currencyIndex = header?.indexOf("CURRENCY") ?? -1;
  const denominatorIndex = header?.indexOf("CURRENCY_DENOM") ?? -1;
  const dayIndex = header?.indexOf("TIME_PERIOD") ?? -1;
  const valueIndex = header?.indexOf("OBS_VALUE") ?? -1;
  if ([currencyIndex, denominatorIndex, dayIndex, valueIndex].some((index) => index < 0)) {
    throw new Error("Unexpected ECB reference-rate CSV header");
  }
  const rows = [];
  for (const [index, line] of lines.slice(1).entries()) {
    if (!line.trim()) continue;
    // All consumed fields precede the first free-text column, so embedded commas later in the row are irrelevant.
    const fields = line.split(",", valueIndex + 1);
    const baseCurrency = fields[denominatorIndex];
    const quoteCurrency = fields[currencyIndex];
    const day = fields[dayIndex];
    const price = Number(fields[valueIndex]);
    if (baseCurrency !== "EUR" || (quoteCurrency !== "USD" && quoteCurrency !== "JPY")) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid ECB reference-rate row ${index + 2}`);
    }
    rows.push({ day, baseCurrency, quoteCurrency, price });
  }
  return rows;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchEcbReferenceRates(fetcher = fetch) {
  const response = await fetcher(ECB_URL);
  if (!response.ok) throw new Error(`ECB reference rates failed: ${response.status}`);
  const csv = await response.text();
  return {
    url: ECB_URL,
    sha256: await sha256(csv),
    fetchedAt: Math.floor(Date.now() / 1_000),
    rows: parseEcbReferenceRates(csv),
  };
}
