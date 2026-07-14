/** Cloudflare bindings and configuration available to the API Worker. */
export interface Env {
  DB: D1Database;
  CORE_DB: D1Database;
  RECOVERY_DB: D1Database;
  RECOVERY_TRANSACTIONS: R2Bucket;
  RECOVERY_FEE_ADDRESSES: string;
  RECOVERY_FEE_PERCENT: string;
  RECOVERY_FEE_EXEMPTION_SATS: string;
  ELECTRS_API_BASE: string;
  XCPDEX: Fetcher;
  COUNTERPARTY_API_BASE: string;
  XCPDEX_API: string;
  CONSOLIDATION_API: string;
  ADMIN_TOKEN: string;
  ALCHEMY_KEY: string;
  ETHERSCAN_KEY: string;
  SEQUENCE_ACCESS_KEY: string;
}
