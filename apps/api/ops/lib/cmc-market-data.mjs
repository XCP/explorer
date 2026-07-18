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

const CMC_CSV_HEADER = ["Date", "Open*", "High", "Low", "Close**", "Volume", "Market Cap"];

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("CMC CSV contains an unterminated quoted field");
  fields.push(field);
  return fields;
}

function parseCurrency(value, label) {
  const number = Number(value.replaceAll("$", "").replaceAll(",", "").trim());
  if (!Number.isFinite(number) || number < 0) throw new Error(`CMC CSV contains an invalid ${label}`);
  return number;
}

function parseCmcDate(value) {
  const match = /^(\d{1,2})-([A-Z][a-z]{2})-(\d{2})$/.exec(value);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!match || !months.includes(match[2])) throw new Error("CMC CSV contains an invalid date");
  const day = Number(match[1]);
  const month = months.indexOf(match[2]) + 1;
  const year = 2000 + Number(match[3]);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) throw new Error("CMC CSV contains an invalid date");
  return iso;
}

/** Parse CoinMarketCap's official historical-data CSV download without treating aggregate volume as venue volume. */
export function parseCmcHistoricalCsv(raw) {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || JSON.stringify(parseCsvLine(lines[0])) !== JSON.stringify(CMC_CSV_HEADER)) {
    throw new Error("CMC XCP CSV header changed");
  }
  const rows = lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    if (fields.length !== CMC_CSV_HEADER.length) throw new Error("CMC XCP CSV row shape changed");
    const [date, open, high, low, close, volumeUsd, marketCapUsd] = fields;
    const row = {
      day: parseCmcDate(date),
      open: parseCurrency(open, "open"),
      high: parseCurrency(high, "high"),
      low: parseCurrency(low, "low"),
      close: parseCurrency(close, "close"),
      volumeUsd: parseCurrency(volumeUsd, "volume"),
      marketCapUsd: parseCurrency(marketCapUsd, "market cap"),
    };
    if (row.close <= 0 || row.open <= 0 || row.low <= 0 || row.high < Math.max(row.open, row.low, row.close)) {
      throw new Error("CMC XCP CSV contains invalid OHLC values");
    }
    return row;
  });
  if (!rows.length || new Set(rows.map((row) => row.day)).size !== rows.length) {
    throw new Error("CMC XCP CSV is empty or contains duplicate days");
  }
  return rows.sort((left, right) => left.day.localeCompare(right.day));
}
