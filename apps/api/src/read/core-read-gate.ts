import type { Env } from "#api/env";

const REQUIRED = ["parity_verified", "forward_write_ready", "read_surface_complete", "projection_writes_ready"];

/** Fail closed unless every durable compact-read prerequisite is explicitly active. */
export async function coreReadsEnabled(env: Pick<Env, "CORE_DB">): Promise<boolean> {
  const rows = await env.CORE_DB.prepare(
    `SELECT key,value FROM core_state
      WHERE key IN ('parity_verified','forward_write_ready','read_surface_complete','projection_writes_ready')`,
  ).all<{ key: string; value: string }>();
  const state = new Map(rows.results.map((row) => [row.key, row.value]));
  return REQUIRED.every((key) => state.get(key) === "1");
}
