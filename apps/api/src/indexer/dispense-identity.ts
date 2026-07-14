interface DispenseIdentity {
  id: number;
  event_index: number;
}

async function applyIdentities(core: D1Database, rows: DispenseIdentity[]): Promise<void> {
  for (let index = 0; index < rows.length; index += 80) {
    await core.batch(
      rows
        .slice(index, index + 80)
        .map((row) =>
          core.prepare(`UPDATE dispenses SET dispense_id=? WHERE event_index=?`).bind(row.id, row.event_index),
        ),
    );
  }
}

/** Preserve source dispense IDs used by the valuation ledger after a normal dual-write event batch. */
export async function reconcileDispenseIdentities(
  source: D1Database,
  core: D1Database,
  eventIndexes: number[],
): Promise<number> {
  if (eventIndexes.length === 0) return 0;
  const rows = await source
    .prepare(`SELECT id,event_index FROM dispenses WHERE event_index IN (${eventIndexes.map(() => "?").join(",")})`)
    .bind(...eventIndexes)
    .all<DispenseIdentity>();
  await applyIdentities(core, rows.results);
  return rows.results.length;
}

/** Historical backfill page, keyed by the source primary key so retries and restarts are idempotent. */
export async function backfillDispenseIdentities(source: D1Database, core: D1Database, after: number, limit: number) {
  const rows = await source
    .prepare(`SELECT id,event_index FROM dispenses WHERE id>? ORDER BY id LIMIT ?`)
    .bind(after, limit)
    .all<DispenseIdentity>();
  await applyIdentities(core, rows.results);
  return {
    processed: rows.results.length,
    next: rows.results.at(-1)?.id ?? after,
    caught_up: rows.results.length < limit,
  };
}
