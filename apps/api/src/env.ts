/** Cloudflare bindings and configuration available to the API Worker. */
export interface Env {
  DB: D1Database;
  LEDGER_DB: D1Database;
  RECOVERY_DB: D1Database;
  RECOVERY_TRANSACTIONS: R2Bucket;
  XCPDEX: Fetcher;
  COUNTERPARTY_API_BASE: string;
  XCPDEX_API: string;
  CONSOLIDATION_API: string;
  ADMIN_TOKEN: string;
  ALCHEMY_KEY: string;
  ETHERSCAN_KEY: string;
  SEQUENCE_ACCESS_KEY: string;
}
