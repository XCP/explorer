import type { Env } from "#api/env";

export type CoreTableDisposition = "compact" | "merge" | "rebuild" | "preserve" | "seed" | "discard" | "platform";

export interface CoreTableManifestEntry {
  source: string;
  target: string | null;
  disposition: CoreTableDisposition;
}

/**
 * Exhaustive classification of the live xcpio schema. A source table may not disappear merely because the
 * compact schema has not implemented it yet: the coverage audit reports every absent target relation.
 */
export const CORE_TABLE_MANIFEST = [
  { source: "_cf_KV", target: null, disposition: "platform" },
  { source: "address_signals", target: "address_signals", disposition: "rebuild" },
  { source: "asset_feed_counts", target: "asset_feed_counts", disposition: "rebuild" },
  { source: "asset_signals", target: "asset_signals", disposition: "rebuild" },
  { source: "assets", target: "assets", disposition: "compact" },
  { source: "balance_snapshots", target: "balance_snapshots", disposition: "compact" },
  { source: "balances", target: "balances", disposition: "compact" },
  { source: "bet_match_resolutions", target: "bet_match_resolutions", disposition: "compact" },
  { source: "bet_matches", target: "bet_matches", disposition: "compact" },
  { source: "bets", target: "bets", disposition: "compact" },
  { source: "blocks", target: "blocks", disposition: "compact" },
  { source: "broadcasts", target: "broadcasts", disposition: "compact" },
  { source: "btc_signals", target: "btc_signals", disposition: "preserve" },
  { source: "btcpays", target: "btcpays", disposition: "compact" },
  { source: "burns", target: "burns", disposition: "compact" },
  { source: "cache", target: null, disposition: "discard" },
  { source: "cancels", target: "cancels", disposition: "compact" },
  { source: "credits", target: "ledger_events", disposition: "merge" },
  { source: "curated", target: "curated", disposition: "preserve" },
  { source: "d1_migrations", target: null, disposition: "platform" },
  { source: "debits", target: "ledger_events", disposition: "merge" },
  { source: "destructions", target: "destructions", disposition: "compact" },
  { source: "dispenser_refills", target: "dispenser_refills", disposition: "compact" },
  { source: "dispensers", target: "dispensers", disposition: "compact" },
  { source: "dispenses", target: "dispenses", disposition: "compact" },
  { source: "dividends", target: "dividends", disposition: "compact" },
  { source: "emblem_listings", target: "emblem_listings", disposition: "preserve" },
  { source: "emblem_sales", target: "emblem_sales", disposition: "preserve" },
  { source: "emblem_scam_sellers", target: "emblem_scam_sellers", disposition: "preserve" },
  { source: "emblem_vaults", target: "emblem_vaults", disposition: "preserve" },
  { source: "exchange_top_assets", target: "exchange_top_assets", disposition: "rebuild" },
  { source: "fairminters", target: "fairminters", disposition: "compact" },
  { source: "fairmints", target: "fairmints", disposition: "compact" },
  { source: "graph_baseline", target: "graph_baseline", disposition: "rebuild" },
  { source: "graph_edges", target: "graph_edges", disposition: "rebuild" },
  { source: "graph_inflow", target: "graph_inflow", disposition: "rebuild" },
  { source: "graph_node", target: "graph_node", disposition: "rebuild" },
  { source: "graph_rank", target: "graph_rank", disposition: "rebuild" },
  { source: "graph_seed", target: "graph_seed", disposition: "rebuild" },
  { source: "indexer_state", target: "core_state", disposition: "seed" },
  { source: "issuances", target: "issuances", disposition: "compact" },
  { source: "network_stats_snapshot", target: "network_stats_snapshot", disposition: "rebuild" },
  { source: "order_matches", target: "order_matches", disposition: "compact" },
  { source: "orders", target: "orders", disposition: "compact" },
  { source: "pool_liquidity", target: "pool_liquidity", disposition: "compact" },
  { source: "pool_matches", target: "pool_matches", disposition: "compact" },
  { source: "pools", target: "pools", disposition: "compact" },
  { source: "pr_edges", target: "pr_edges", disposition: "rebuild" },
  { source: "prices", target: "prices", disposition: "rebuild" },
  { source: "rps", target: "rps", disposition: "compact" },
  { source: "rps_matches", target: "rps_matches", disposition: "compact" },
  { source: "scarce_city_sales", target: "scarce_city_sales", disposition: "preserve" },
  { source: "sends", target: "sends", disposition: "compact" },
  { source: "sqlite_sequence", target: null, disposition: "platform" },
  { source: "sqlite_stat1", target: null, disposition: "platform" },
  { source: "sweeps", target: "sweeps", disposition: "compact" },
  { source: "tags", target: "tags", disposition: "rebuild" },
  { source: "trades", target: "trades", disposition: "rebuild" },
  { source: "transactions", target: "transactions", disposition: "compact" },
  { source: "xcp_btc_daily", target: "xcp_btc_daily", disposition: "preserve" },
] as const satisfies readonly CoreTableManifestEntry[];

export const GENERATED_CORE_TABLES = ["address_dictionary", "asset_dictionary", "entity_dictionary"] as const;

export const CORE_SNAPSHOT_TABLES = CORE_TABLE_MANIFEST.filter(
  (entry) => entry.disposition !== "platform" && entry.disposition !== "discard",
).map((entry) => entry.source);

interface SchemaTable {
  name: string;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function difference(left: readonly string[], right: ReadonlySet<string>): string[] {
  return left.filter((value) => !right.has(value));
}

export async function auditCoreTableCoverage(env: Pick<Env, "DB" | "CORE_DB">) {
  const [sourceResult, targetResult] = await Promise.all([
    env.DB.prepare(`SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name`).all<SchemaTable>(),
    env.CORE_DB.prepare(`SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name`).all<SchemaTable>(),
  ]);
  const sourceTables = sorted(sourceResult.results.map((row) => row.name));
  const targetTables = sorted(targetResult.results.map((row) => row.name));
  const manifestSources = sorted(CORE_TABLE_MANIFEST.map((entry) => entry.source));
  const requiredTargets = sorted([
    ...CORE_TABLE_MANIFEST.flatMap((entry) => (entry.target == null ? [] : [entry.target])),
    ...GENERATED_CORE_TABLES,
  ]);
  const sourceSet = new Set(sourceTables);
  const manifestSet = new Set(manifestSources);
  const targetSet = new Set(targetTables);
  const ignoredTargetTables = new Set(["_cf_KV", "d1_migrations", "sqlite_sequence", "sqlite_stat1"]);
  const unexpectedTargets = targetTables.filter(
    (table) => !requiredTargets.includes(table) && !ignoredTargetTables.has(table),
  );
  const unclassifiedSources = difference(sourceTables, manifestSet);
  const absentSources = difference(manifestSources, sourceSet);
  const missingTargets = difference(requiredTargets, targetSet);

  return {
    complete: unclassifiedSources.length === 0 && absentSources.length === 0 && missingTargets.length === 0,
    counts: {
      source: sourceTables.length,
      manifest: manifestSources.length,
      required_target: requiredTargets.length,
      present_target: targetTables.length,
    },
    unclassified_sources: unclassifiedSources,
    absent_sources: absentSources,
    missing_targets: missingTargets,
    unexpected_targets: unexpectedTargets,
  };
}
