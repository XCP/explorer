/**
 * Public-only recovery fee address derivation.
 *
 * The Worker receives an account-level BIP86 xpub, never a seed or private key. Each durable
 * allocation derives receive branch `0/index` and emits a key-path Taproot output. The database owns
 * index allocation and keeps the exact address/path needed for later reconciliation and spending.
 *
 * This is the marketplace's platform fee design (`packages/market/src/fee-address.ts` there) carried
 * over unchanged, so both revenue lines share one wallet layout: recovery on the seed's account 0,
 * the marketplace on account 1.
 */
import { HDKey, type Versions } from "@scure/bip32";
import { Address, NETWORK, OutScript, p2tr, TEST_NETWORK } from "@scure/btc-signer";
import { hex } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";

const MAINNET_VERSIONS: Versions = { private: 0x0488ade4, public: 0x0488b21e };
const TESTNET_VERSIONS: Versions = { private: 0x04358394, public: 0x043587cf };

/**
 * Recovery owns account 0 of the revenue seed (m/86'/0'/0'); the marketplace owns account 1. Each
 * service allocates derivation indexes from zero on its own, so sharing one account would hand the
 * same address to two customers of two products. The serialized key carries its own child index, so
 * the wrong account is caught before it derives anything.
 */
const RECOVERY_ACCOUNT_INDEX = 0x80000000;

type FeeNetwork = "mainnet" | "testnet";

export class RecoveryFeeKeyError extends Error {}

export interface DerivedRecoveryFeeAddress {
  address: string;
  scriptPubKeyHex: string;
  derivationIndex: number;
  path: string;
  keyId: string;
}

function formatForKey(extendedKey: string): { versions: Versions; network: FeeNetwork } {
  if (extendedKey.startsWith("xpub")) return { versions: MAINNET_VERSIONS, network: "mainnet" };
  if (extendedKey.startsWith("tpub")) return { versions: TESTNET_VERSIONS, network: "testnet" };
  throw new RecoveryFeeKeyError("recovery fee key must be a BIP86 account-level xpub or tpub");
}

function readPublicAccount(extendedKey: string): { account: HDKey; network: FeeNetwork } {
  const format = formatForKey(extendedKey);
  let account: HDKey;
  try {
    account = HDKey.fromExtendedKey(extendedKey, format.versions);
  } catch {
    throw new RecoveryFeeKeyError("recovery fee extended public key is invalid");
  }
  if (account.privateKey !== null) {
    throw new RecoveryFeeKeyError("recovery fee configuration must never contain a private key");
  }
  if (account.depth !== 3) {
    throw new RecoveryFeeKeyError("recovery fee key must be a BIP86 account-level public key");
  }
  if (account.index !== RECOVERY_ACCOUNT_INDEX) {
    throw new RecoveryFeeKeyError(
      "recovery fee key must be account 0 (m/86'/0'/0'); account 1 belongs to the marketplace",
    );
  }
  if (!account.publicKey || !account.chainCode) {
    throw new RecoveryFeeKeyError("recovery fee public key is incomplete");
  }
  return { account, network: format.network };
}

/** Stable identifier for the public account node, independent of its text. */
export function recoveryFeeKeyId(extendedKey: string): string {
  const { account } = readPublicAccount(extendedKey);
  const material = new Uint8Array(account.publicKey!.length + account.chainCode!.length);
  material.set(account.publicKey!, 0);
  material.set(account.chainCode!, account.publicKey!.length);
  return hex.encode(sha256(material)).slice(0, 24);
}

export function deriveRecoveryFeeAddress(
  extendedKey: string,
  derivationIndex: number,
  network: FeeNetwork = "mainnet",
): DerivedRecoveryFeeAddress {
  if (!Number.isSafeInteger(derivationIndex) || derivationIndex < 0 || derivationIndex >= 0x80000000) {
    throw new RecoveryFeeKeyError("recovery fee derivation index is out of range");
  }
  const parsed = readPublicAccount(extendedKey);
  if (parsed.network !== network) {
    throw new RecoveryFeeKeyError(`recovery fee public key does not match ${network}`);
  }
  const child = parsed.account.deriveChild(0).deriveChild(derivationIndex);
  if (!child.publicKey) throw new RecoveryFeeKeyError("could not derive recovery fee public key");
  // BIP86 uses the x-only child key as the Taproot internal key. p2tr applies the required
  // empty-tree TapTweak and emits the key-path script.
  const payment = p2tr(child.publicKey.slice(1), undefined, network === "mainnet" ? NETWORK : TEST_NETWORK);
  return {
    address: payment.address!,
    scriptPubKeyHex: hex.encode(payment.script),
    derivationIndex,
    path: `0/${derivationIndex}`,
    keyId: recoveryFeeKeyId(extendedKey),
  };
}

/**
 * The static address list that predates the xpub. Its addresses are still honoured as fee outputs
 * while the secret remains configured, so a recovery built moments before the cutover still reports
 * cleanly; delete the secret once no such transaction can still be in flight.
 */
export function legacyFeeScriptsHex(configured: string): string[] {
  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((address) => {
      try {
        const decoded = Address(NETWORK).decode(address);
        return decoded ? [hex.encode(OutScript.encode(decoded))] : [];
      } catch {
        return [];
      }
    });
}

export interface RecoveryFeeAddressRow {
  id: number;
  scope: string;
  key_id: string | null;
  derivation_index: number | null;
  derivation_path: string | null;
  address: string | null;
  script_pubkey_hex: string | null;
}

export type AllocatedRecoveryFeeAddress = RecoveryFeeAddressRow & { address: string; script_pubkey_hex: string };

const COLUMNS = "id,scope,key_id,derivation_index,derivation_path,address,script_pubkey_hex";

function feeAddressByScope(db: D1Database, scope: string): Promise<RecoveryFeeAddressRow | null> {
  return db
    .prepare(`SELECT ${COLUMNS} FROM recovery_fee_addresses WHERE scope=?`)
    .bind(scope)
    .first<RecoveryFeeAddressRow>();
}

/**
 * One address per scope, allocated once and returned forever after. The row's id minus one is its
 * derivation index: reserving the id and completing the address are separate statements, so a crash
 * between them leaves a recoverable null row, never an address assigned to two scopes. The lookup
 * comes first because repeat reads of the same batch are the common case and a no-op insert is
 * still a billed write.
 */
export async function allocateRecoveryFeeAddress(
  db: D1Database,
  extendedKey: string,
  scope: string,
  now: number,
): Promise<AllocatedRecoveryFeeAddress> {
  if (!/^recovery:[0-9a-f]{64}:[0-9]+$/.test(scope)) throw new Error("recovery fee scope is invalid");
  let row = await feeAddressByScope(db, scope);
  if (!row) {
    await db
      .prepare(
        `INSERT INTO recovery_fee_addresses (scope,created_at,updated_at)
         SELECT ?1,?2,?2 WHERE NOT EXISTS (SELECT 1 FROM recovery_fee_addresses WHERE scope=?1)`,
      )
      .bind(scope, now)
      .run();
    row = await feeAddressByScope(db, scope);
    if (!row) throw new Error("recovery fee address reservation vanished");
  }
  if (row.address === null) {
    const derived = deriveRecoveryFeeAddress(extendedKey, row.id - 1);
    await db
      .prepare(
        `UPDATE recovery_fee_addresses
            SET key_id=?2,derivation_index=?3,derivation_path=?4,address=?5,script_pubkey_hex=?6,updated_at=?7
          WHERE id=?1 AND address IS NULL`,
      )
      .bind(row.id, derived.keyId, derived.derivationIndex, derived.path, derived.address, derived.scriptPubKeyHex, now)
      .run();
    row = await feeAddressByScope(db, scope);
    if (!row) throw new Error("recovery fee address allocation vanished");
  }
  if (row.address === null || row.script_pubkey_hex === null) {
    throw new Error("recovery fee address allocation is incomplete");
  }
  return row as AllocatedRecoveryFeeAddress;
}
