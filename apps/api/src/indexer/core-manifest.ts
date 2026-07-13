import type { Env } from "#api/env";

export type CoreTableDisposition = "compact" | "merge" | "preserve" | "seed" | "discard" | "platform";

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
  { source: "address_signals", target: "address_signals", disposition: "preserve" },
  { source: "asset_feed_counts", target: "asset_feed_counts", disposition: "preserve" },
  { source: "asset_signals", target: "asset_signals", disposition: "preserve" },
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
  { source: "exchange_top_assets", target: "exchange_top_assets", disposition: "preserve" },
  { source: "fairminters", target: "fairminters", disposition: "compact" },
  { source: "fairmints", target: "fairmints", disposition: "compact" },
  { source: "graph_baseline", target: "graph_baseline", disposition: "preserve" },
  { source: "graph_edges", target: "graph_edges", disposition: "preserve" },
  { source: "graph_inflow", target: "graph_inflow", disposition: "preserve" },
  { source: "graph_node", target: "graph_node", disposition: "preserve" },
  { source: "graph_rank", target: "graph_rank", disposition: "preserve" },
  { source: "graph_seed", target: "graph_seed", disposition: "preserve" },
  { source: "indexer_state", target: "core_state", disposition: "seed" },
  { source: "issuances", target: "issuances", disposition: "compact" },
  { source: "network_stats_snapshot", target: "network_stats_snapshot", disposition: "preserve" },
  { source: "order_matches", target: "order_matches", disposition: "compact" },
  { source: "orders", target: "orders", disposition: "compact" },
  { source: "pool_liquidity", target: "pool_liquidity", disposition: "compact" },
  { source: "pool_matches", target: "pool_matches", disposition: "compact" },
  { source: "pools", target: "pools", disposition: "compact" },
  { source: "pr_edges", target: "pr_edges", disposition: "preserve" },
  { source: "prices", target: "prices", disposition: "preserve" },
  { source: "rps", target: "rps", disposition: "compact" },
  { source: "rps_matches", target: "rps_matches", disposition: "compact" },
  { source: "scarce_city_sales", target: "scarce_city_sales", disposition: "preserve" },
  { source: "sends", target: "sends", disposition: "compact" },
  { source: "sqlite_sequence", target: null, disposition: "platform" },
  { source: "sqlite_stat1", target: null, disposition: "platform" },
  { source: "sweeps", target: "sweeps", disposition: "compact" },
  { source: "tags", target: "tags", disposition: "preserve" },
  { source: "trades", target: "trades", disposition: "preserve" },
  { source: "transactions", target: "transactions", disposition: "compact" },
  { source: "xcp_btc_daily", target: "xcp_btc_daily", disposition: "preserve" },
] as const satisfies readonly CoreTableManifestEntry[];

export const GENERATED_CORE_TABLES = ["address_dictionary", "asset_dictionary", "cache", "entity_dictionary"] as const;

interface CoreColumnRule {
  targets: readonly string[];
  invariant?: "null_only";
}

/** Source columns whose compact representation is not the same name or the conventional `${name}_id`. */
export const CORE_COLUMN_RULES: Readonly<Record<string, Readonly<Record<string, CoreColumnRule>>>> = {
  assets: {
    asset: { targets: ["asset_id"] },
    asset_id: { targets: ["numeric_asset_id"] },
  },
  balance_snapshots: { holder: { targets: ["address_id", "utxo_tx_hash", "utxo_vout"] } },
  balances: { holder: { targets: ["address_id", "utxo_tx_hash", "utxo_vout"] } },
  bet_match_resolutions: {
    bet_match_id: { targets: ["bet_match_tx0_index", "bet_match_tx1_index"] },
  },
  bet_matches: { id: { targets: ["tx0_index", "tx1_index"] } },
  btcpays: {
    id: { targets: ["event_index"] },
    order_match_id: { targets: ["order_match_tx0_index", "order_match_tx1_index"] },
  },
  cancels: { offer_hash: { targets: ["offer_tx_index"] } },
  destructions: { id: { targets: ["event_index"] } },
  dispenser_refills: { dispenser_tx_hash: { targets: ["dispenser_tx_index"] } },
  dispenses: {
    id: { targets: ["event_index"] },
    dispenser_tx_hash: { targets: ["dispenser_tx_index"] },
  },
  fairmints: {
    id: { targets: ["event_index"] },
    fairminter_tx_hash: { targets: ["fairminter_tx_index"] },
  },
  issuances: { id: { targets: ["event_index"] } },
  order_matches: { id: { targets: ["tx0_index", "tx1_index"] } },
  pool_liquidity: { id: { targets: ["event_index"] } },
  pool_matches: {
    id: { targets: ["event_index"] },
    order_tx_hash: { targets: ["order_tx_index"] },
  },
  rps_matches: { id: { targets: ["tx0_index", "tx1_index"] } },
  sends: { id: { targets: ["event_index"] } },
  transactions: { data: { targets: [], invariant: "null_only" } },
};

export const CORE_SNAPSHOT_TABLES = CORE_TABLE_MANIFEST.filter(
  (entry) => entry.disposition !== "platform" && entry.disposition !== "discard",
).map((entry) => entry.source);

interface SchemaTable {
  name: string;
}

interface SchemaColumn {
  name: string;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function difference(left: readonly string[], right: ReadonlySet<string>): string[] {
  return left.filter((value) => !right.has(value));
}

export async function auditCoreTableCoverage(env: Pick<Env, "DB" | "CORE_DB">) {
  const compactEntries = CORE_TABLE_MANIFEST.filter((entry) => entry.disposition === "compact");
  const [sourceResult, targetResult, sourceColumnResults, targetColumnResults] = await Promise.all([
    env.DB.prepare(`SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name`).all<SchemaTable>(),
    env.CORE_DB.prepare(`SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name`).all<SchemaTable>(),
    Promise.all(
      compactEntries.map((entry) => env.DB.prepare(`PRAGMA table_info("${entry.source}")`).all<SchemaColumn>()),
    ),
    Promise.all(
      compactEntries.map((entry) => env.CORE_DB.prepare(`PRAGMA table_xinfo("${entry.target}")`).all<SchemaColumn>()),
    ),
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
  const unmappedSourceColumns: { table: string; columns: string[] }[] = [];
  const missingRepresentationColumns: { table: string; source_column: string; targets: readonly string[] }[] = [];
  compactEntries.forEach((entry, index) => {
    if (entry.target == null || !targetSet.has(entry.target)) return;
    const sourceColumns = sourceColumnResults[index].results.map((column) => column.name);
    const targetColumns = new Set(targetColumnResults[index].results.map((column) => column.name));
    const unmapped: string[] = [];
    for (const sourceColumn of sourceColumns) {
      const rule = CORE_COLUMN_RULES[entry.source]?.[sourceColumn];
      if (rule) {
        const missing = rule.targets.filter((target) => !targetColumns.has(target));
        if (missing.length > 0) {
          missingRepresentationColumns.push({
            table: entry.source,
            source_column: sourceColumn,
            targets: missing,
          });
        }
        continue;
      }
      if (!targetColumns.has(sourceColumn) && !targetColumns.has(`${sourceColumn}_id`)) unmapped.push(sourceColumn);
    }
    if (unmapped.length > 0) unmappedSourceColumns.push({ table: entry.source, columns: unmapped });
  });

  return {
    complete:
      unclassifiedSources.length === 0 &&
      absentSources.length === 0 &&
      missingTargets.length === 0 &&
      unmappedSourceColumns.length === 0 &&
      missingRepresentationColumns.length === 0,
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
    unmapped_source_columns: unmappedSourceColumns,
    missing_representation_columns: missingRepresentationColumns,
  };
}
