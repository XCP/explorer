/** Cloudflare bindings and configuration available to the API Worker. */
export interface Env {
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
  ADMIN_TOKEN: string;
  ALCHEMY_KEY: string;
  ETHERSCAN_KEY: string;
  SEQUENCE_ACCESS_KEY: string;
  /** Optional: sustains the CMC aggregate calendar via free-tier quotes/latest; job skips when unset. */
  CMC_API_KEY?: string;
}
