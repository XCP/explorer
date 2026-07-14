/** Computed-tag reconciliation. Current matches are upserted before stale matches are removed. */
import type { Env } from "#api/env";

type Scope = "asset" | "address";
interface Rule {
  tag: string;
  scope: Scope;
  select: string;
}

const addressSelect = (condition: string) => `SELECT entity.entity_id
  FROM address_signals signal
  JOIN address_dictionary dictionary ON dictionary.address_id=signal.address_id
  JOIN entity_dictionary entity ON entity.entity_type='address' AND entity.entity_key=dictionary.address
  WHERE ${condition}`;
const assetSelect = (condition: string) => `SELECT entity.entity_id
  FROM asset_signals signal
  JOIN asset_dictionary dictionary ON dictionary.asset_id=signal.asset_id
  JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=dictionary.asset
  WHERE ${condition}`;
const assetRecordSelect = (condition: string) => `SELECT entity.entity_id
  FROM assets asset JOIN asset_dictionary dictionary ON dictionary.asset_id=asset.asset_id
  JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=dictionary.asset
  WHERE ${condition}`;

const RULES: Rule[] = [
  { tag: "exchange", scope: "address", select: addressSelect("signal.is_exchange=1") },
  { tag: "deposit", scope: "address", select: addressSelect("signal.is_deposit=1") },
  { tag: "burn", scope: "address", select: addressSelect("signal.is_burn=1") },
  { tag: "vault", scope: "address", select: addressSelect("signal.is_emblem_vault=1") },
  {
    tag: "vault_funder",
    scope: "address",
    select: `SELECT DISTINCT entity.entity_id FROM sends send
      JOIN emblem_vaults vault ON vault.btc_address_id=send.destination_address_id
      JOIN address_dictionary dictionary ON dictionary.address_id=send.source_address_id
      JOIN entity_dictionary entity ON entity.entity_type='address' AND entity.entity_key=dictionary.address
      WHERE send.source_address_id IS NOT NULL`,
  },
  {
    tag: "vault_cracker",
    scope: "address",
    select: `SELECT DISTINCT entity.entity_id FROM sends send
      JOIN emblem_vaults vault ON vault.btc_address_id=send.source_address_id
      JOIN address_dictionary dictionary ON dictionary.address_id=send.destination_address_id
      JOIN entity_dictionary entity ON entity.entity_type='address' AND entity.entity_key=dictionary.address
      WHERE send.destination_address_id IS NOT NULL`,
  },
  { tag: "service", scope: "address", select: addressSelect("signal.likely_service=1") },
  { tag: "trader", scope: "address", select: addressSelect("signal.dex_trades>=10") },
  { tag: "active_trader", scope: "address", select: addressSelect("signal.dex_trades>=100") },
  { tag: "collector", scope: "address", select: addressSelect("signal.assets_held>=100") },
  { tag: "whale", scope: "address", select: addressSelect("signal.assets_held>=500") },
  { tag: "merchant", scope: "address", select: addressSelect("signal.dispenses>=5") },
  { tag: "creator", scope: "address", select: addressSelect("signal.survived_assets>=1") },
  { tag: "prolific_creator", scope: "address", select: addressSelect("signal.survived_assets>=20") },
  { tag: "burner", scope: "address", select: addressSelect("signal.assets_burned>=3") },
  { tag: "dividend_payer", scope: "address", select: addressSelect("signal.dividends>=1") },
  { tag: "stamp_creator", scope: "address", select: addressSelect("signal.stamps_created>=5") },
  { tag: "stamp_collector", scope: "address", select: addressSelect("signal.stamps_collected>=20") },
  { tag: "src20_deployer", scope: "address", select: addressSelect("signal.src20_deploys>=1") },
  { tag: "btns_user", scope: "address", select: addressSelect("signal.is_btns_user=1") },
  {
    tag: "og",
    scope: "address",
    select: addressSelect(
      "signal.first_block<=(SELECT max(block_index)-43800 FROM blocks) AND signal.last_block>=850000",
    ),
  },
  { tag: "wash", scope: "asset", select: assetSelect("signal.low_quality=1") },
  { tag: "liquid", scope: "asset", select: assetSelect("signal.trades>=10") },
  { tag: "durable", scope: "asset", select: assetSelect("signal.last_trade_blk-signal.first_trade_blk>=43800") },
  { tag: "broad", scope: "asset", select: assetSelect("signal.holders>=50") },
  {
    tag: "vaulted",
    scope: "asset",
    select: assetSelect(`EXISTS(SELECT 1 FROM balances balance JOIN emblem_vaults vault
      ON vault.btc_address_id=balance.address_id WHERE balance.asset_id=signal.asset_id
      AND CAST(balance.quantity AS INTEGER)>0)`),
  },
  { tag: "pre-ethereum", scope: "asset", select: assetRecordSelect("asset.first_issuance_block_index<367561") },
  {
    tag: "pre-cryptopunks",
    scope: "asset",
    select: assetRecordSelect("asset.first_issuance_block_index<470436"),
  },
  { tag: "named", scope: "asset", select: assetRecordSelect("asset.type='asset'") },
  { tag: "subasset", scope: "asset", select: assetRecordSelect("asset.type='subasset'") },
  { tag: "numeric", scope: "asset", select: assetRecordSelect("asset.type='numeric'") },
];

const chunks = <T>(items: T[], size = 800): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

async function ensureEntities(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key)
      SELECT 'asset',asset FROM asset_dictionary`),
    db.prepare(`INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key)
      SELECT 'address',address FROM address_dictionary`),
  ]);
}

async function reconcileRule(db: D1Database, rule: Rule, keys?: string[]): Promise<number> {
  const placeholders = keys?.map(() => "?").join(",");
  const selected = keys
    ? `SELECT entity_id FROM entity_dictionary WHERE entity_type=? AND entity_key IN (${placeholders})`
    : null;
  const current = selected ? `${rule.select} INTERSECT ${selected}` : rule.select;
  const write = await db
    .prepare(
      `INSERT INTO tags(entity_id,tag,source)
      SELECT entity_id,?,'computed' FROM (${current}) WHERE 1
      ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source WHERE tags.source='computed'`,
    )
    .bind(rule.tag, ...(keys ? [rule.scope, ...keys] : []))
    .run();
  await db
    .prepare(
      `DELETE FROM tags WHERE source='computed' AND tag=?
      ${selected ? `AND entity_id IN (${selected})` : ""}
      AND entity_id NOT IN (${rule.select})`,
    )
    .bind(rule.tag, ...(keys ? [rule.scope, ...keys] : []))
    .run();
  return write.meta.rows_written ?? 0;
}

export async function buildTags(env: Env, opts: { includeTypes?: boolean } = {}): Promise<Record<string, unknown>> {
  const db = env.CORE_DB;
  await ensureEntities(db);
  const rules =
    opts.includeTypes === false ? RULES.filter((rule) => !["named", "subasset", "numeric"].includes(rule.tag)) : RULES;
  let written = 0;
  for (const rule of rules) written += await reconcileRule(db, rule);
  await db
    .prepare(
      `INSERT INTO tags(entity_id,tag,source)
    SELECT entity.entity_id,'grail','curated' FROM curated item
    JOIN entity_dictionary entity ON entity.entity_type='asset' AND entity.entity_key=item.key
    WHERE item.kind='grail' ON CONFLICT(entity_id,tag) DO UPDATE SET source=excluded.source`,
    )
    .run();
  await db
    .prepare(
      `DELETE FROM tags WHERE source='curated' AND tag='grail' AND entity_id NOT IN (
    SELECT entity.entity_id FROM curated item JOIN entity_dictionary entity
      ON entity.entity_type='asset' AND entity.entity_key=item.key WHERE item.kind='grail')`,
    )
    .run();
  const total = await db.prepare(`SELECT count(*) count FROM tags`).first<{ count: number }>();
  return { rules: rules.length, written, total_tags: total?.count ?? 0 };
}

export async function buildTagsScoped(
  env: Env,
  dirty: { assets: string[]; addrs: string[] },
): Promise<Record<string, unknown>> {
  const db = env.CORE_DB;
  await ensureEntities(db);
  let written = 0;
  for (const scope of ["address", "asset"] as const) {
    const keys = scope === "asset" ? dirty.assets : dirty.addrs;
    for (const part of chunks(keys)) {
      if (part.length === 0) continue;
      for (const rule of RULES.filter((candidate) => candidate.scope === scope))
        written += await reconcileRule(db, rule, part);
    }
  }
  return { dirty_addrs: dirty.addrs.length, dirty_assets: dirty.assets.length, written };
}
