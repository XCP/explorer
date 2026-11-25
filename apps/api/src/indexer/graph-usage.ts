import type { Env } from "#api/env";
import { setCoreState } from "#api/indexer/core-state";

// Opt-in measurement for one pending edge revision. A record belongs to one attempt, including retries.
export async function measureGraphRefresh<T>(
  env: Env,
  phase: string,
  first: D1Meta,
  run: (env: Env) => Promise<T>,
): Promise<T> {
  const db = env.CORE_DB;
  const target = await db
    .prepare(
      `SELECT value FROM core_state WHERE key='graph_diff_revision' AND CAST(value AS INTEGER)>0
      AND value=(SELECT value FROM core_state WHERE key='graph_usage_target_revision')`,
    )
    .first<string>("value")
    .catch(() => null);
  if (!target) return run(env);

  const start = Date.now();
  const key = `graph_usage:${target}:${start}:${crypto.randomUUID()}`;
  const minutes: Record<string, { reads: number; writes: number; statements: number }> = {
    [Math.floor(start / 60_000)]: { reads: first.rows_read, writes: first.rows_written, statements: 1 },
  };
  let status = "running";
  let lastSaved = start;
  let pendingWrites = 0;
  const save = async () => {
    try {
      await setCoreState(db, key, JSON.stringify({ phase, start, through: Date.now(), status, minutes }));
      lastSaved = Date.now();
      pendingWrites = 0;
    } catch (error) {
      console.error("graph usage checkpoint", String(error));
    }
  };
  const record = async (results: D1Result[]) => {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const bucket = (minutes[minute] ??= { reads: 0, writes: 0, statements: 0 });
    for (const { meta } of results) {
      bucket.reads += meta.rows_read;
      bucket.writes += meta.rows_written;
      bucket.statements++;
      pendingWrites += meta.rows_written;
    }
    if (now - lastSaved >= 60_000 || pendingWrites >= 10_000) await save();
  };
  // Batch must receive native, bound D1 statements. The wrapper only observes returned metadata.
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const execute = async <R>(method: "all" | "run") => {
      const result = await statement[method]<R>();
      await record([result]);
      return result;
    };
    const wrapped: D1PreparedStatement = {
      bind: (...values) => wrap(statement.bind(...values)),
      all: <R>() => execute<R>("all"),
      run: <R>() => execute<R>("run"),
      // first() omits metadata. All first() queries in the refresh return at most one row.
      first: async <R>(column?: string) => {
        const row = (await execute<Record<string, unknown>>("all")).results[0];
        return ((column === undefined ? row : row?.[column]) as R) ?? null;
      },
      raw: statement.raw.bind(statement),
    };
    originals.set(wrapped, statement);
    return wrapped;
  };
  const metered: D1Database = {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async <R>(statements: D1PreparedStatement[]) => {
      const results = await db.batch<R>(statements.map((s) => originals.get(s) ?? s));
      await record(results);
      return results;
    },
    exec: db.exec.bind(db),
    dump: db.dump.bind(db),
    withSession: db.withSession.bind(db),
  };
  await save();
  try {
    const result = await run({ ...env, CORE_DB: metered });
    status = "ok";
    return result;
  } catch (error) {
    status = "error";
    throw error;
  } finally {
    await save();
  }
}
