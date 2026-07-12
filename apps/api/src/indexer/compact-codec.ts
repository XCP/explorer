/** Convert a conventional 64-character transaction hash to its 32 raw bytes. */
export function hashToBytes(hash: string | null | undefined): Uint8Array | null {
  if (hash == null) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error("invalid transaction hash");
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hash.slice(i * 2, i * 2 + 2), 16);
  return out;
}
