/**
 * Emblem Vault crawler. An Emblem Vault is an Ethereum NFT (ERC-1155/721) that wraps assets on another
 * chain; for Counterparty it backs a Bitcoin address that owns the wrapped card. We store only the three
 * facts we can verify — (contract, token_id, btc_address) — and derive "what's in the vault" from our
 * OWN Counterparty ledger, never Emblem's balance API.
 *
 * PRIMARY: Alchemy getNFTsForContract?withMetadata=true returns BOTH the uint256 token id AND the vault's
 * metadata (which embeds addresses:[{coin:'BTC',address}]). So one keyed, paginated call yields token_id +
 * btc_address together — no separate Emblem call, no Emblem rate-limit exposure.
 * FALLBACK (Alchemy down): Etherscan getLogs enumerates mint token ids; those are then resolved to a BTC
 * address via the keyless Emblem /meta (called WITH the SDK's x-api-key header to get the proper limit).
 *
 * Resumable per-contract pageKey/block cursor in indexer_state; bounded per step (cron + admin driven).
 */
import type { Env } from "#api/env";
import { fetchAlchemyContractNfts } from "#api/integrations/alchemy-nfts";
import { fetchEtherscanMintLogs } from "#api/integrations/etherscan-logs";
import { fetchEmblemCuratedCollections } from "#api/integrations/emblem-curated";
import { fetchEmblemMetadata } from "#api/integrations/emblem-metadata";
import { upsertCoreEmblemVaultIdentities } from "#api/indexer/core-projections";
import {
  getIndexerState as getState,
  getIndexerStateStringArray,
  setIndexerState as setState,
} from "#api/indexer/state";

const TRANSFER_SINGLE = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const TRANSFER_BATCH = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";
const ZERO_TOPIC = "0x" + "0".repeat(64);
const ETHERSCAN_PAGE = 1000;
const RESOLVE_PER_STEP = 200;
const META_CONCURRENCY = 16;
const STATS_REFRESH_SECONDS = 24 * 60 * 60;

export const EMBLEM_DDL = `CREATE TABLE IF NOT EXISTS emblem_vaults (token_id TEXT PRIMARY KEY, contract TEXT, btc_address TEXT, resolved INTEGER DEFAULT 0, first_seen INTEGER)`;
export const EMBLEM_IDX = `CREATE INDEX IF NOT EXISTS idx_emblem_btc ON emblem_vaults(btc_address)`;
const EMBLEM_IDX2 = `CREATE INDEX IF NOT EXISTS idx_emblem_unresolved ON emblem_vaults(resolved)`;

const hexToDec = (hex: string) => BigInt(hex).toString();
const pickBtc = (addrs: unknown): string | null => {
  if (!Array.isArray(addrs)) return null;
  const x = (addrs as Array<{ coin?: string; address?: string }>).find(
    (a) => (a?.coin === "BTC" || a?.coin === "Bitcoin") && typeof a?.address === "string" && a.address.startsWith("1"),
  );
  return x?.address ?? null;
};

// Legacy Emblem contracts of interest that aren't in /curated (early/Counterparty vaults). Add lowercased
// mainnet addresses here; they're merged with the live curated set. The is_emblem_vault join only
// labels addresses that actually appear in our Counterparty ledger, so a non-Counterparty contract here is harmless.
const LEGACY_CONTRACTS: string[] = [
  "0x82c7a8f707110f5fbb16184a5933e9f78a34c6ab", // Emblem Vault V4 (the main "emblem-vault" collection; ERC-721,
  // ~40k tokens incl. Rare Pepe). Alchemy metadata lacks addresses
  // here, so these resolve via /meta. Non-Counterparty vaults are filtered by the join.
  // emblem-vault-matic is on Polygon — needs a polygon-mainnet Alchemy endpoint (follow-up if Counterparty vaults exist there).
];

// Counterparty-bearing Emblem contracts (collectionChain 'xcp' / addressChain BTC / nativeAssets ⊇ XCP|BTC)
// from /curated, merged with the legacy set above.
async function counterpartyContracts(): Promise<{ contracts: string[]; complete: boolean }> {
  const out = new Set<string>(LEGACY_CONTRACTS.map((a) => a.toLowerCase()));
  try {
    const list = await fetchEmblemCuratedCollections();
    for (const c of list) {
      const na: string[] = c?.nativeAssets || [];
      const isCp =
        c?.collectionChain === "xcp" || c?.addressChain === "BTC" || na.includes("XCP") || na.includes("BTC");
      const address = c?.contracts?.["1"];
      if (isCp && typeof address === "string" && address.startsWith("0x")) out.add(address.toLowerCase());
    }
    return { contracts: [...out], complete: true };
  } catch {
    return { contracts: [...out], complete: false };
  }
}

// PRIMARY enumerate+resolve in one: token id + BTC address straight from Alchemy metadata.
async function enumAlchemy(
  key: string,
  contract: string,
  pageKey: string,
): Promise<{ rows: { id: string; btc: string | null }[]; cursor: string }> {
  const page = await fetchAlchemyContractNfts(key, contract, pageKey);
  const rows = page.nfts.map((nft) => ({ id: nft.tokenId, btc: pickBtc(nft.raw?.metadata?.addresses) }));
  return { rows, cursor: page.pageKey || "" };
}

// FALLBACK enumerate: Etherscan mint logs -> token ids only (BTC resolved later via /meta).
async function enumEtherscan(
  key: string,
  contract: string,
  fromBlock: number,
): Promise<{ ids: string[]; cursor: string }> {
  const ids = new Set<string>();
  let last = fromBlock;
  for (const topic0 of [TRANSFER_SINGLE, TRANSFER_BATCH]) {
    const logs = await fetchEtherscanMintLogs(key, contract, topic0, ZERO_TOPIC, fromBlock, ETHERSCAN_PAGE);
    for (const log of logs) {
      last = Math.max(last, parseInt(log.blockNumber, 16));
      const w = (log.data || "0x").slice(2).match(/.{64}/g) || [];
      if (topic0 === TRANSFER_SINGLE) ids.add(hexToDec("0x" + w[0]));
      else {
        const n = parseInt(w[2] || "0", 16);
        for (let i = 0; i < n; i++) ids.add(hexToDec("0x" + (w[3 + i] || "0")));
      }
    }
  }
  return { ids: [...ids], cursor: ids.size >= ETHERSCAN_PAGE ? String(last) : "" };
}

// Resolve a token id to its BTC address via keyless Emblem /meta (with the SDK's x-api-key header so we
// get the proper rate limit). Tri-state: ok=false = fetch failed/blank (retry); ok=true = valid record.
async function resolveBtc(tokenId: string): Promise<{ ok: boolean; btc: string | null }> {
  try {
    const metadata = await fetchEmblemMetadata(tokenId, {
      headers: { "x-api-key": "demo", "user-agent": "xcp.io-indexer" },
      acceptNotFound: false,
    });
    // A 200 is DEFINITIVE. Emblem's "not found" record for a bogus/burned token id has NO addresses[]; mark it
    // ok anyway (btc=null) so it drains as resolved. Otherwise those ~20k unresolvable ids sit at the front of
    // the `resolved=0 LIMIT 60` queue and get retried forever (the stall), starving real tokens behind them.
    return { ok: true, btc: pickBtc(metadata.addresses) };
  } catch {
    return { ok: false, btc: null };
  } // network/parse error -> retry later
}

/** One bounded, resumable crawl step: enumerate (+resolve) the active contract's next page via Alchemy;
 *  if Alchemy errors, enumerate token ids via Etherscan and drain them through /meta. Cron / admin driven. */
export async function crawlEmblemStep(env: Env): Promise<Record<string, unknown>> {
  const ak = (env as { ALCHEMY_KEY?: string }).ALCHEMY_KEY;
  const ek = (env as { ETHERSCAN_KEY?: string }).ETHERSCAN_KEY;
  await env.DB.prepare(EMBLEM_DDL).run();
  await env.DB.prepare(EMBLEM_IDX).run();
  await env.DB.prepare(EMBLEM_IDX2).run();
  const now = Math.floor(Date.now() / 1000);
  const out: Record<string, unknown> = { enumerated: 0, resolved: 0 };

  let contracts = await getIndexerStateStringArray(env.DB, "emblem_contracts");
  if (!contracts.length) {
    const discovered = await counterpartyContracts();
    contracts = discovered.contracts;
    if (discovered.complete && contracts.length) await setState(env.DB, "emblem_contracts", JSON.stringify(contracts));
  }

  if (contracts.length && (ak || ek)) {
    let ci = parseInt((await getState(env.DB, "emblem_contract_idx")) || "0", 10);
    if (ci >= contracts.length) ci = 0;
    const contract = contracts[ci];
    const curKey = `emblem_cur_${contract}`;
    const cursor = (await getState(env.DB, curKey)) || "";
    const usingEs = cursor.startsWith("es:");
    try {
      let nextCursor = "";
      if (ak && !usingEs) {
        let r: { rows: { id: string; btc: string | null }[]; cursor: string };
        try {
          r = await enumAlchemy(ak, contract, cursor);
          out.provider = "alchemy";
        } catch (e) {
          if (!ek) throw e;
          const es = await enumEtherscan(ek, contract, 0);
          out.provider = "etherscan(fallback)";
          r = { rows: es.ids.map((id) => ({ id, btc: null })), cursor: es.cursor ? "es:" + es.cursor : "" };
        }
        // Per row: if Alchemy metadata already gave the BTC address -> resolved=1; otherwise (legacy
        // contracts whose Alchemy metadata lacks addresses, or etherscan-fallback) -> resolved=0 so the
        // /meta pass fills it. Never mark resolved without an address.
        for (let i = 0; i < r.rows.length; i += 50) {
          const page = r.rows.slice(i, i + 50);
          await env.DB.batch(
            page.map((x) =>
              env.DB.prepare(
                `INSERT INTO emblem_vaults (token_id,contract,btc_address,resolved,first_seen) VALUES (?,?,?,?,?)
                            ON CONFLICT(token_id) DO UPDATE SET btc_address=COALESCE(excluded.btc_address,emblem_vaults.btc_address), resolved=MAX(emblem_vaults.resolved,excluded.resolved)`,
              ).bind(x.id, contract, x.btc, x.btc ? 1 : 0, now),
            ),
          );
          await upsertCoreEmblemVaultIdentities(
            env.CORE_DB,
            page.map((x) => ({ tokenId: x.id, contract, btcAddress: x.btc, resolved: x.btc ? 1 : 0, firstSeen: now })),
          );
        }
        out.enumerated = r.rows.length;
        nextCursor = r.cursor;
      } else if (ek) {
        const es = await enumEtherscan(ek, contract, parseInt(cursor.slice(3) || "0", 10));
        out.provider = "etherscan";
        for (let i = 0; i < es.ids.length; i += 50) {
          const ids = es.ids.slice(i, i + 50);
          await env.DB.batch(
            ids.map((id) =>
                env.DB.prepare(
                  `INSERT INTO emblem_vaults (token_id,contract,resolved,first_seen) VALUES (?,?,0,?) ON CONFLICT(token_id) DO NOTHING`,
                ).bind(id, contract, now),
              ),
          );
          await upsertCoreEmblemVaultIdentities(
            env.CORE_DB,
            ids.map((id) => ({ tokenId: id, contract, btcAddress: null, resolved: 0, firstSeen: now })),
          );
        }
        out.enumerated = es.ids.length;
        nextCursor = es.cursor ? "es:" + es.cursor : "";
      }
      out.contract = contract;
      if (nextCursor) await setState(env.DB, curKey, nextCursor);
      else {
        await setState(env.DB, curKey, "");
        await setState(env.DB, "emblem_contract_idx", String((ci + 1) % contracts.length));
        out.contract_done = true;
      }
    } catch (e) {
      out.enum_err = String(e).slice(0, 120);
    }
  } else if (!ak && !ek) out.enum_skipped = "no keys";

  // ---- RESOLVE leftovers (Etherscan-fallback rows or any unresolved) via /meta ----
  const rows = (
    await env.DB.prepare(`SELECT token_id FROM emblem_vaults WHERE resolved=0 LIMIT ?`)
      .bind(RESOLVE_PER_STEP)
      .all<{ token_id: string }>()
  ).results;
  let resolved = 0;
  for (let i = 0; i < rows.length; i += META_CONCURRENCY) {
    const slice = rows.slice(i, i + META_CONCURRENCY);
    const res = await Promise.all(slice.map(async (r) => ({ id: r.token_id, ...(await resolveBtc(r.token_id)) })));
    const done = res.filter((r) => r.ok);
    if (done.length) {
      await env.DB.batch(
        done.map((r) =>
          env.DB.prepare(`UPDATE emblem_vaults SET btc_address=?, resolved=1 WHERE token_id=?`).bind(r.btc, r.id),
        ),
      );
      await upsertCoreEmblemVaultIdentities(
        env.CORE_DB,
        done.map((r) => ({ tokenId: r.id, contract: null, btcAddress: r.btc, resolved: 1, firstSeen: null })),
      );
    }
    resolved += done.length;
  }
  out.resolved = resolved;
  return out;
}

/** Refresh the lifetime Emblem segmentation off the request path at most once per day. */
export async function maybeRefreshEmblemStats(env: Env): Promise<Record<string, unknown>> {
  const now = Math.floor(Date.now() / 1000);
  const last = Number((await getState(env.CORE_DB, "emblem_stats_updated_at")) || 0);
  if (now - last < STATS_REFRESH_SECONDS) return { skipped: true, updated_at: last };

  const vaultAddresses = `SELECT DISTINCT btc_address_id FROM emblem_vaults WHERE btc_address_id IS NOT NULL`;
  const statements = [
    `SELECT COUNT(*) value FROM emblem_vaults WHERE btc_address_id IS NOT NULL`,
    `WITH vault_addresses AS (${vaultAddresses}) SELECT COUNT(*) value FROM vault_addresses vault
       WHERE EXISTS (SELECT 1 FROM balances balance WHERE balance.address_id=vault.btc_address_id
         AND CAST(balance.quantity AS INTEGER)>0)`,
    `WITH vault_addresses AS (${vaultAddresses}) SELECT COUNT(DISTINCT send.destination_id) value
       FROM vault_addresses vault JOIN sends send ON send.source_id=vault.btc_address_id
       LEFT JOIN vault_addresses destination ON destination.btc_address_id=send.destination_id
       WHERE send.destination_id IS NOT NULL AND destination.btc_address_id IS NULL`,
    `WITH vault_addresses AS (${vaultAddresses}) SELECT COUNT(DISTINCT send.destination_id) value
       FROM vault_addresses vault JOIN sends send ON send.source_id=vault.btc_address_id
       JOIN vault_addresses destination ON destination.btc_address_id=send.destination_id`,
    `WITH vault_addresses AS (${vaultAddresses}) SELECT COUNT(DISTINCT send.source_id) value
       FROM vault_addresses vault JOIN sends send ON send.destination_id=vault.btc_address_id`,
    `SELECT COUNT(*) value FROM address_signals WHERE assets_held>0`,
    `SELECT COUNT(*) value FROM address_signals WHERE assets_held>0 AND is_emblem_vault=0
       AND is_exchange=0 AND is_burn=0 AND is_deposit=0 AND likely_service=0`,
  ];
  const results = await env.CORE_DB.batch<{ value: number }>(
    statements.map((statement) => env.CORE_DB.prepare(statement)),
  );
  const values = results.map((result) => Number(result.results?.[0]?.value ?? 0));
  await env.CORE_DB.batch([
    env.CORE_DB.prepare(
      `INSERT INTO emblem_stats
       (id,vaults,funded,cracked_to_user,revaulted,depositors,all_holders,real_users,updated_at)
       VALUES(1,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET vaults=excluded.vaults,funded=excluded.funded,
       cracked_to_user=excluded.cracked_to_user,revaulted=excluded.revaulted,
       depositors=excluded.depositors,all_holders=excluded.all_holders,
       real_users=excluded.real_users,updated_at=excluded.updated_at`,
    ).bind(...values, now),
    env.CORE_DB.prepare(
      `INSERT INTO core_state(key,value) VALUES('emblem_stats_updated_at',?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).bind(String(now)),
  ]);
  return { refreshed: true, updated_at: now };
}
