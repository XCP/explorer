export async function getIndexerState(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM indexer_state WHERE key=?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function getIndexerStateInt(db: D1Database, key: string, fallback = 0): Promise<number> {
  const value = await getIndexerState(db, key);
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getIndexerStateStringArray(db: D1Database, key: string): Promise<string[]> {
  const value = await getIndexerState(db, key);
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export async function setIndexerState(db: D1Database, key: string, value: string | number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO indexer_state (key,value) VALUES (?,?) " + "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .bind(key, String(value))
    .run();
}
