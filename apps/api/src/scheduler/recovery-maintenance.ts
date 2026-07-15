import type { Env } from "#api/env";
import { runCoreAddressSignalsStep } from "#api/indexer/core-address-signals";
import { maybeBuildGraph } from "#api/indexer/graph";
import { reconcileRecoveryAttempts } from "#api/recovery/attempts";
import { scanRecoveryTransactions } from "#api/recovery/scanner";
import { refreshRecoveryStats } from "#api/recovery/stats";
import { verifyRecoveryTransactions } from "#api/recovery/verify";
import { runScheduledJob } from "#api/scheduler/job";

/** Independent recovery-database/provider lane; never delays canonical ingestion or projections. */
export async function runRecoveryMaintenance(env: Env): Promise<void> {
  // Address projection gets a fresh CORE_DB invocation. Running it after the large asset projection can exhaust
  // D1's internal compound-statement budget even though both jobs are independently valid.
  await runScheduledJob("runCoreAddressSignalsStep", () => runCoreAddressSignalsStep(env.CORE_DB));
  await runScheduledJob("scanRecoveryTransactions", () => scanRecoveryTransactions(env, 20));
  await runScheduledJob("verifyRecoveryTransactions", () => verifyRecoveryTransactions(env, 10));
  await runScheduledJob("reconcileRecoveryAttempts", () => reconcileRecoveryAttempts(env, 25));
  await runScheduledJob("refreshRecoveryStats", () => refreshRecoveryStats(env));
  // The graph is built and internally block-gated; an occasional rebuild follows recovery on this lane.
  await runScheduledJob("maybeBuildGraph", () => maybeBuildGraph(env));
}
