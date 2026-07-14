import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  CLASSIFY_DUMP_VAULTS_SQL,
  CLASSIFY_SCAM_SHELLS_SQL,
  CLEAR_STALE_SCAM_SELLERS_SQL,
  ENSURE_DUMP_SIGNAL_ROWS_SQL,
  ENSURE_SHELL_SIGNAL_ROWS_SQL,
  ENSURE_VAULT_SCAM_SIGNAL_ROWS_SQL,
  ENSURE_VAULT_SIGNAL_ROWS_SQL,
  REFRESH_DUMP_SIGNALS_SQL,
  REFRESH_LIKELY_SERVICE_SQL,
  REFRESH_SCAM_SELLERS_SQL,
  REFRESH_SHELL_SIGNALS_SQL,
  REFRESH_VAULT_FLAGS_SQL,
  REFRESH_VAULT_SCAM_SIGNALS_SQL,
} from "#api/indexer/emblem-scam";

test("Emblem scam attribution converges without reset-first writes", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE emblem_vaults(
      contract_id INTEGER,token_id TEXT,btc_address_id INTEGER,vault_kind TEXT,
      claimed_asset_id INTEGER,contents_asset_id INTEGER,contents_qty REAL,has_contents INTEGER,
      is_scam_shell INTEGER DEFAULT 0,is_dump INTEGER DEFAULT 0,cracked_at INTEGER,cracker_address_id INTEGER,
      PRIMARY KEY(contract_id,token_id));
    CREATE TABLE emblem_sales(token_id TEXT,contract_id INTEGER,seller_id INTEGER,block_number INTEGER);
    CREATE TABLE emblem_scam_sellers(seller_id INTEGER PRIMARY KEY,scams INTEGER DEFAULT 0);
    CREATE TABLE sends(source_address_id INTEGER,destination_address_id INTEGER,asset_id INTEGER);
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY,shell_scams INTEGER DEFAULT 0,
      dump_scams INTEGER DEFAULT 0,vault_scams INTEGER DEFAULT 0,is_emblem_vault INTEGER DEFAULT 0,
      likely_service INTEGER DEFAULT 0,is_exchange INTEGER DEFAULT 0,is_burn INTEGER DEFAULT 0,
      assets_issued INTEGER DEFAULT 0,in_peers INTEGER DEFAULT 0);
    CREATE TABLE asset_signals(asset_id INTEGER PRIMARY KEY,supply REAL DEFAULT 0);
    INSERT INTO asset_dictionary VALUES(1,'XCP'),(2,'CARD'),(3,'JUNK');
    INSERT INTO emblem_vaults(contract_id,token_id,btc_address_id,vault_kind,claimed_asset_id,
      contents_asset_id,contents_qty,has_contents,is_scam_shell,is_dump,cracked_at,cracker_address_id) VALUES
      (100,'real-a',20,'single',NULL,2,1,1,0,0,NULL,NULL),
      (100,'real-b',21,'single',NULL,2,1,1,0,0,NULL,NULL),
      (100,'shell',NULL,'foreign',2,NULL,NULL,0,0,0,NULL,NULL),
      (100,'dump',22,'single',NULL,3,1,1,0,0,NULL,NULL),
      (100,'cracked',23,'single',NULL,2,1,1,0,0,1600000000,12);
    INSERT INTO emblem_sales VALUES
      ('real-a',100,1,16000000),('real-b',100,1,16000000),('shell',100,1,16000000),
      ('dump',100,2,16000000),('cracked',100,3,16000000);
    INSERT INTO sends VALUES(10,20,2),(10,21,2),(11,22,3);
    INSERT INTO address_signals(address_id,shell_scams,dump_scams,vault_scams,in_peers)
      VALUES(12,5,5,5,600),(13,0,0,0,600);
    INSERT INTO asset_signals VALUES(2,100),(3,2000000);
  `);
  for (const sql of [
    CLASSIFY_SCAM_SHELLS_SQL,
    ENSURE_VAULT_SIGNAL_ROWS_SQL,
    REFRESH_VAULT_FLAGS_SQL,
    REFRESH_SCAM_SELLERS_SQL,
    CLEAR_STALE_SCAM_SELLERS_SQL,
    ENSURE_SHELL_SIGNAL_ROWS_SQL,
    REFRESH_SHELL_SIGNALS_SQL,
    CLASSIFY_DUMP_VAULTS_SQL,
    ENSURE_DUMP_SIGNAL_ROWS_SQL,
    REFRESH_DUMP_SIGNALS_SQL,
    ENSURE_VAULT_SCAM_SIGNAL_ROWS_SQL,
    REFRESH_VAULT_SCAM_SIGNALS_SQL,
    REFRESH_LIKELY_SERVICE_SQL,
  ])
    db.exec(sql);
  assert.deepEqual(
    db
      .prepare(`SELECT token_id,is_scam_shell,is_dump FROM emblem_vaults ORDER BY token_id`)
      .all()
      .map((row) => ({ ...row })),
    [
      { token_id: "cracked", is_scam_shell: 0, is_dump: 0 },
      { token_id: "dump", is_scam_shell: 0, is_dump: 1 },
      { token_id: "real-a", is_scam_shell: 0, is_dump: 0 },
      { token_id: "real-b", is_scam_shell: 0, is_dump: 0 },
      { token_id: "shell", is_scam_shell: 1, is_dump: 0 },
    ],
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT address_id,shell_scams,dump_scams FROM address_signals
        WHERE shell_scams>0 OR dump_scams>0 OR address_id=12 ORDER BY address_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { address_id: 10, shell_scams: 1, dump_scams: 0 },
      { address_id: 11, shell_scams: 0, dump_scams: 1 },
      { address_id: 12, shell_scams: 0, dump_scams: 0 },
    ],
  );
  assert.deepEqual(
    { ...db.prepare(`SELECT vault_scams,likely_service FROM address_signals WHERE address_id=12`).get() },
    { vault_scams: 1, likely_service: 1 },
  );
  assert.deepEqual(
    { ...db.prepare(`SELECT is_emblem_vault,likely_service FROM address_signals WHERE address_id=20`).get() },
    { is_emblem_vault: 1, likely_service: 0 },
  );
  assert.equal(db.prepare(`SELECT likely_service FROM address_signals WHERE address_id=13`).get()?.likely_service, 1);
  db.exec(REFRESH_SCAM_SELLERS_SQL);
  db.exec(REFRESH_SHELL_SIGNALS_SQL);
  assert.equal(db.prepare(`SELECT scams FROM emblem_scam_sellers WHERE seller_id=1`).get()?.scams, 1);
  db.close();
});
