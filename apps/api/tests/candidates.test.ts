import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { chosenCollectorCounts, collectorCandidateSeeds } from "#api/queries/candidates";

const migrations = readdirSync("migrations-core")
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(`migrations-core/${name}`, "utf8"));

class Statement {
  private values: unknown[] = [];
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }
}

const d1 = (db: DatabaseSync) => ({ prepare: (sql: string) => new Statement(db, sql) }) as unknown as D1Database;

test("collection candidates aggregate holders before enrichment and retain the chosen-acquisition gate", async () => {
  const db = new DatabaseSync(":memory:");
  for (const migration of migrations) db.exec(migration);
  db.exec(`
    INSERT INTO address_dictionary(address)
      VALUES('1distributor'),('1issuer'),('1collector1'),('1collector2'),('1collector3'),('1collector4'),('1collector5');
    INSERT INTO address_signals(address_id,assets_held,assets_received)
      SELECT address_id,10,20 FROM address_dictionary WHERE address LIKE '1collector%';
    INSERT INTO address_reputations(
      address_id,reputation,rank_position,population,duration_score,creation_score,
      economic_score,participation_score,calculated_at,model_version)
      SELECT address_id,50,1,5,0,0,0,0,1,1 FROM address_dictionary WHERE address LIKE '1collector%';

    INSERT INTO asset_dictionary(asset) VALUES('CHOSEN'),('AIRDROP'),('TAGGED'),('LOWQ');
    INSERT INTO assets(asset_id,type,issuer_id,divisible,locked,first_issuance_block_index)
      SELECT asset_id,'asset',(SELECT address_id FROM address_dictionary WHERE address='1issuer'),0,1,1
      FROM asset_dictionary WHERE asset IN ('CHOSEN','AIRDROP','TAGGED','LOWQ');
    INSERT INTO asset_signals(asset_id,holders,low_quality)
      SELECT asset_id,5,CASE asset WHEN 'LOWQ' THEN 1 ELSE 0 END
      FROM asset_dictionary WHERE asset IN ('CHOSEN','AIRDROP','TAGGED','LOWQ');
    INSERT INTO balances(address_id,asset_id,quantity,updated_event_index)
      SELECT address.address_id,asset.asset_id,'1',1
      FROM address_dictionary address CROSS JOIN asset_dictionary asset
      WHERE address.address LIKE '1collector%' AND asset.asset IN ('CHOSEN','AIRDROP','TAGGED','LOWQ');

    INSERT INTO entity_dictionary(entity_type,entity_key) VALUES('asset','TAGGED');
    INSERT INTO collection_membership_evidence(entity_id,tag,source)
      SELECT entity_id,'Known Collection','manual' FROM entity_dictionary
      WHERE entity_type='asset' AND entity_key='TAGGED';

    INSERT INTO sends(event_index,tx_index,tx_hash,block_index,source_id,destination_id,
      source_address_id,destination_address_id,asset_id,quantity,msg_index)
      SELECT 100+address.address_id,100+address.address_id,randomblob(32),1,
        distributor.address_id,address.address_id,distributor.address_id,address.address_id,
        asset.asset_id,'1',0
      FROM address_dictionary address
      JOIN address_dictionary distributor ON distributor.address='1distributor'
      JOIN asset_dictionary asset ON asset.asset='AIRDROP'
      WHERE address.address LIKE '1collector%';
    INSERT INTO sends(event_index,tx_index,tx_hash,block_index,source_id,destination_id,
      source_address_id,destination_address_id,asset_id,quantity,msg_index)
      SELECT 200+address.address_id,200+address.address_id,randomblob(32),1,
        distributor.address_id,address.address_id,distributor.address_id,address.address_id,
        asset.asset_id,'1',0
      FROM address_dictionary address
      JOIN address_dictionary distributor ON distributor.address='1distributor'
      JOIN asset_dictionary asset ON asset.asset='CHOSEN'
      WHERE address.address LIKE '1collector%';
    INSERT INTO dispenses(event_index,tx_index,dispense_index,tx_hash,dispenser_tx_index,
      source_id,destination_id,asset_id,dispense_quantity,btc_amount,block_index)
      SELECT 1,1,0,randomblob(32),1,distributor.address_id,collector.address_id,
        asset.asset_id,'1','10000',1
      FROM address_dictionary distributor,address_dictionary collector,asset_dictionary asset
      WHERE distributor.address='1distributor' AND collector.address='1collector1' AND asset.asset='CHOSEN';
  `);

  const core = d1(db);
  const seeds = await collectorCandidateSeeds(core, 150);
  assert.deepEqual(
    seeds.map(({ asset, collector_holders }) => ({ asset, collector_holders })),
    [
      { asset: "CHOSEN", collector_holders: 5 },
      { asset: "AIRDROP", collector_holders: 5 },
    ],
  );

  // One JSON bind supports the route's full 150-seed batch without crossing D1's SQL-variable ceiling.
  const fillerIds = Array.from({ length: 148 }, (_, index) => 1_000_000 + index);
  const chosen = await chosenCollectorCounts(core, [...seeds.map((seed) => seed.asset_id), ...fillerIds]);
  assert.deepEqual(
    chosen.map((row) => ({ ...row })),
    [{ asset_id: seeds[0]!.asset_id, chosen_collectors: 1 }],
  );
});
