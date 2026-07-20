import { base58check, bech32, bech32m } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";

const check = base58check(sha256);

function validWitness(address, codec, minimumVersion, maximumVersion) {
  try {
    const decoded = codec.decode(address);
    if (decoded.prefix !== "bc" || decoded.words.length < 1) return false;
    const version = decoded.words[0];
    if (version < minimumVersion || version > maximumVersion) return false;
    const program = codec.fromWords(decoded.words.slice(1));
    if (program.length < 2 || program.length > 40) return false;
    return version !== 0 || program.length === 20 || program.length === 32;
  } catch {
    return false;
  }
}

/** Strict mainnet Base58Check or native SegWit address validation. */
export function isMainnetBitcoinAddress(address) {
  if (typeof address !== "string") return false;
  if (address.startsWith("1") || address.startsWith("3")) {
    try {
      const payload = check.decode(address);
      return payload.length === 21 && (payload[0] === 0 || payload[0] === 5);
    } catch {
      return false;
    }
  }
  if (!address.startsWith("bc1")) return false;
  return validWitness(address, bech32, 0, 0) || validWitness(address, bech32m, 1, 16);
}

/** Counterparty UTXO-address form used for assets attached to a specific output. */
export function parseCounterpartyUtxoEntity(value) {
  if (typeof value !== "string") return null;
  const match = /^([0-9a-fA-F]{64}):([0-9]+)$/.exec(value);
  if (!match) return null;
  const vout = Number(match[2]);
  if (!Number.isSafeInteger(vout) || vout < 0 || vout > 0xffff_ffff || String(vout) !== match[2]) return null;
  return { txid: match[1].toLowerCase(), vout };
}

/** Counterparty's canonical m_pubkeyhash..._n multisig identity representation. */
export function parseCounterpartyMultisigIdentity(value) {
  if (typeof value !== "string" || !value.includes("_")) return null;
  const parts = value.split("_");
  if (parts.length < 4 || parts.length > 5) return null;
  const required = Number(parts[0]);
  const possible = Number(parts.at(-1));
  const members = parts.slice(1, -1);
  if (
    !Number.isInteger(required) ||
    required < 1 ||
    required > 3 ||
    !Number.isInteger(possible) ||
    possible < 2 ||
    possible > 3 ||
    possible !== members.length
  )
    return null;
  if (
    !members.every((member) => {
      if (!member.startsWith("1")) return false;
      try {
        const payload = check.decode(member);
        return payload.length === 21 && payload[0] === 0;
      } catch {
        return false;
      }
    })
  )
    return null;
  const canonicalMembers = [...members].sort();
  if (members.some((member, index) => member !== canonicalMembers[index])) return null;
  return { required, members, possible };
}
