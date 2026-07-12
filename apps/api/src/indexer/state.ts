import type { Env } from "../index";

export async function getIndexerState(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM indexer_state WHERE key=?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function getIndexerStateInt(env: Env, key: string, fallback = 0): Promise<number> {
  const value = await getIndexerState(env, key);
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function setIndexerState(env: Env, key: string, value: string | number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO indexer_state (key,value) VALUES (?,?) " +
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  )
    .bind(key, String(value))
    .run();
}
