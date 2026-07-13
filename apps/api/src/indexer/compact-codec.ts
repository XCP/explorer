/** Convert a conventional 64-character transaction hash to its 32 raw bytes. */
export function hashToBytes(hash: string | null | undefined): Uint8Array | null {
  if (hash == null) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error("invalid transaction hash");
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hash.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Decode the holder identity Counterparty uses for balances attached to a UTXO. */
export function parseUtxoHolder(holder: string): { txHash: Uint8Array; vout: number } {
  const match = /^([0-9a-fA-F]{64}):(0|[1-9][0-9]*)$/.exec(holder);
  if (!match) throw new Error("invalid UTXO balance holder");
  const txHash = hashToBytes(match[1]);
  const vout = Number(match[2]);
  if (!txHash || !Number.isSafeInteger(vout)) throw new Error("invalid UTXO balance holder");
  return { txHash, vout };
}
