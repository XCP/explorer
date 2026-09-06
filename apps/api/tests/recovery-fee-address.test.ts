import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveRecoveryFeeAddress,
  legacyFeeScriptsHex,
  recoveryFeeKeyId,
  RecoveryFeeKeyError,
} from "#api/recovery/fee-address";

// BIP86 test vectors: account 0 of the "abandon … about" mnemonic.
const ACCOUNT_XPUB =
  "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";
const ACCOUNT_XPRV =
  "xprv9xgqHN7yz9MwCkxsBPN5qetuNdQSUttZNKw1dcYTV4mkaAFiBVGQziHs3NRSWMkCzvgjEe3n9xV8oYywvM8at9yRqyaZVz6TYYhX98VjsUk";
const ROOT_XPUB =
  "xpub661MyMwAqRbcFkPHucMnrGNzDwb6teAX1RbKQmqtEF8kK3Z7LZ59qafCjB9eCRLiTVG3uxBxgKvRgbubRhqSKXnGGb1aoaqLrpMBDrVxga8";
// The same mnemonic's account 1 (m/86'/0'/1'): the marketplace's account, never recovery's.
const MARKETPLACE_ACCOUNT_XPUB =
  "xpub6BgBgsespWvEUBtu8NPpew4suu4JeuYz1ryQBqRKYk6BCN4p6nugJwXyBFjwPS93FTP4Rvkgqzhoy4ZysXh6f6jPWrjwbtG5PBzqPJghDkT";

test("recovery fee addresses follow the BIP86 receive branch of the account key", () => {
  const first = deriveRecoveryFeeAddress(ACCOUNT_XPUB, 0);
  assert.equal(first.address, "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
  assert.equal(first.path, "0/0");
  assert.equal(first.derivationIndex, 0);
  assert.match(first.scriptPubKeyHex, /^5120[0-9a-f]{64}$/);
  assert.equal(first.keyId, recoveryFeeKeyId(ACCOUNT_XPUB));

  const second = deriveRecoveryFeeAddress(ACCOUNT_XPUB, 1);
  assert.equal(second.address, "bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh");
  assert.notEqual(second.scriptPubKeyHex, first.scriptPubKeyHex);
});

test("recovery fee configuration rejects private keys, non-account keys and bad indexes", () => {
  // An xprv never reaches the parser: the prefix alone disqualifies it.
  assert.throws(() => deriveRecoveryFeeAddress(ACCOUNT_XPRV, 0), /xpub or tpub/);
  try {
    deriveRecoveryFeeAddress(ACCOUNT_XPRV, 0);
  } catch (error) {
    assert.ok(error instanceof RecoveryFeeKeyError);
  }
  assert.throws(() => deriveRecoveryFeeAddress(ROOT_XPUB, 0), /account-level/);
  assert.throws(() => deriveRecoveryFeeAddress(MARKETPLACE_ACCOUNT_XPUB, 0), /must be account 0/);
  assert.throws(() => deriveRecoveryFeeAddress("not-a-key", 0), /xpub or tpub/);
  assert.throws(() => deriveRecoveryFeeAddress(ACCOUNT_XPUB, -1), /out of range/);
  assert.throws(() => deriveRecoveryFeeAddress(ACCOUNT_XPUB, 0x80000000), /out of range/);
  assert.throws(() => deriveRecoveryFeeAddress(ACCOUNT_XPUB, 0, "testnet"), /does not match testnet/);
});

test("legacy fee addresses resolve to their scripts and ignore junk", () => {
  const scripts = legacyFeeScriptsHex(" 1BitcoinEaterAddressDontSendf59kuE, nonsense ,");
  assert.deepEqual(scripts, ["76a914759d6677091e973b9e9d99f19c68fbf43e3f05f988ac"]);
  assert.deepEqual(legacyFeeScriptsHex(""), []);
});
