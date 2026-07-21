/** API Worker composition root: bindings, route modules, error boundary, and cron dispatch. */
import { Hono } from "hono";
import { admin } from "#api/admin";
import type { Env } from "#api/env";
export type { Env } from "#api/env";
import { extensionApi } from "#api/extension-api";
import { describeHttpError, requestId } from "#api/http/errors";
import { requestTelemetry } from "#api/http/telemetry";
import { syncCoreEvents } from "#api/indexer/sync";
import { read } from "#api/read/router";
import { recoveryRead } from "#api/recovery/read";
import { runCanonicalMaintenance } from "#api/scheduler/canonical-maintenance";
import { runScheduledJob } from "#api/scheduler/job";
import { runRecoveryMaintenance } from "#api/scheduler/recovery-maintenance";
import { verify } from "#api/verify";

const app = new Hono<{ Bindings: Env }>();

// Workers Logs head-samples this bounded record at the configured 1% rate. Entity identifiers and raw
// attacker-controlled paths are deliberately excluded.
app.use("*", requestTelemetry);

// Replica-local, stale-tolerant reads. Cache writes still route to the primary.
app.use("/v2/*", async (c, next) => {
  const db = c.env.CORE_DB as unknown as { withSession?: (mode?: string) => D1Database };
  if (typeof db.withSession === "function") c.env = { ...c.env, CORE_DB: db.withSession("first-unconstrained") };
  await next();
});

app.get("/", (c) => c.text("api.xcp.io ok"));
// Dependency-free liveness. `/v2/status` is the bounded database readiness/lag signal.
app.get("/health", (c) => c.text("ok"));
app.route("/", read);
app.route("/", verify);
app.route("/", extensionApi);
app.route("/", admin);
app.route("/", recoveryRead);

app.onError((error, c) => {
  const failure = describeHttpError(error);
  const id = requestId(c.req.header("X-Request-Id"));
  console.error({
    event: "request_error",
    request_id: id,
    method: c.req.method,
    path: c.req.path,
    status: failure.status,
    error: failure.internal,
  });
  c.header("X-Request-Id", id);
  return c.json({ error: failure.publicMessage }, failure.status);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === "1-59/2 * * * *") {
      ctx.waitUntil(runRecoveryMaintenance(env));
      return;
    }
    ctx.waitUntil(
      (async () => {
        // Canonical ingestion has its own D1 lock and always gets the first opportunity to advance.
        const sync = await runScheduledJob("syncCoreEvents", () => syncCoreEvents(env, { maxEvents: 10_000 }));
        if (sync?.caught_up) await runCanonicalMaintenance(env);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
