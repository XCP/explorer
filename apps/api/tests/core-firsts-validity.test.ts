import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRSTS } from "../src/queries/firsts.js";

const STATUS_BACKED_FIRSTS = [
  "burn", "asset", "destruction", "send", "order", "order_match", "dispenser",
  "dividend", "broadcast", "bet", "bet_match", "rps", "rps_match", "sweep",
  "cancel", "btcpay", "non_xcp_order", "enhanced_send", "mpma", "attach", "move",
  "detach", "locked", "divisible", "indivisible", "one_of_one", "reset", "transfer",
  "callable", "description", "json_desc", "inscription", "easyasset", "fairminter", "fairmint",
  "pool_deposit", "pool_swap", "stamp", "src20", "src721", "btns",
  "priced_oracle", "sweep_memo", "send_memo", "description_lock",
  "fairminter_premint", "fairminter_commission", "fairminter_burn_payment",
  "numeric_one_of_one", "subasset_one_of_one", "satoshi_nft", "tokenless",
  "non_ascii_description", "embedded_image",
  "description_url", "pepe_mention", "nft_term",
];

test("every first backed by a protocol-status table excludes invalid records", () => {
  const byKey = new Map(FIRSTS.map((entry) => [entry.key, entry.sql]));
  for (const key of STATUS_BACKED_FIRSTS) {
    const sql = byKey.get(key);
    assert.equal(typeof sql, "string", `missing firsts entry ${key}`);
    assert.match(sql!, /status NOT LIKE 'invalid%'/, `${key} does not exclude invalid records`);
  }
});

test("only the literal first transaction displays a transaction hash as its subject", () => {
  for (const entry of FIRSTS) {
    if (entry.key === "transaction") continue;
    assert.equal(/HEX\(.+\) ref,'tx' typ/.test(entry.sql), false, `${entry.key} exposes a hash as its subject`);
  }
});
