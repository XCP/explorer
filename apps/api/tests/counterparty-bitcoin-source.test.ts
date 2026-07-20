import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isMainnetBitcoinAddress,
  parseCounterpartyMultisigIdentity,
  parseCounterpartyUtxoEntity,
} from "#ops/lib/bitcoin-address";

test("validates mainnet payment addresses without accepting Counterparty entity strings", () => {
  assert.equal(isMainnetBitcoinAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"), true);
  assert.equal(isMainnetBitcoinAddress("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"), true);
  assert.equal(isMainnetBitcoinAddress("bc1qvw44al3dmtqkxpv49lp376dc5pz66nkad6p36l"), true);
  assert.equal(isMainnetBitcoinAddress("71342e070ab70f4b41ca7e4740e6bc7a7f3852410f78870949d38022cf421248:0"), false);
  assert.equal(
    isMainnetBitcoinAddress("1_12dYXSf5vzEMUYVxeTihub4cK5J4aT5ciw_14rQ7Lp7Db2ahowxcVTBRyUv6Qf9ZWy8PV_2"),
    false,
  );
});

test("parses only Counterparty-canonical UTXO entity strings", () => {
  const txid = "71342e070ab70f4b41ca7e4740e6bc7a7f3852410f78870949d38022cf421248";
  assert.deepEqual(parseCounterpartyUtxoEntity(`${txid}:0`), { txid, vout: 0 });
  assert.equal(parseCounterpartyUtxoEntity(`${txid}:00`), null);
  assert.equal(parseCounterpartyUtxoEntity(`${txid}:-1`), null);
  assert.equal(parseCounterpartyUtxoEntity(`${txid.slice(1)}:0`), null);
});

test("parses Counterparty sorted multisig identities and rejects malformed composites", () => {
  const first = "12dYXSf5vzEMUYVxeTihub4cK5J4aT5ciw";
  const second = "14rQ7Lp7Db2ahowxcVTBRyUv6Qf9ZWy8PV";
  assert.deepEqual(parseCounterpartyMultisigIdentity(`1_${first}_${second}_2`), {
    required: 1,
    members: [first, second],
    possible: 2,
  });
  assert.equal(parseCounterpartyMultisigIdentity(`1_${second}_${first}_2`), null);
  assert.equal(parseCounterpartyMultisigIdentity(`1_${first}_2`), null);
  assert.equal(parseCounterpartyMultisigIdentity(`1_${first}_not-an-address_2`), null);
});
