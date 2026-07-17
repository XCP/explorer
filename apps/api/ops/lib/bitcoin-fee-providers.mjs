function integerFee(value, provider) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${provider} returned an invalid fee`);
  return value;
}

export const BITCOIN_FEE_PROVIDERS = [
  {
    name: "counterparty",
    minIntervalMs: 250,
    url: (txid) => `https://api.counterparty.io:3000/tx/${txid}`,
    parse: (value) => integerFee(value?.fee, "counterparty"),
  },
  {
    name: "blockstream",
    minIntervalMs: 500,
    url: (txid) => `https://blockstream.info/api/tx/${txid}`,
    parse: (value) => integerFee(value?.fee, "blockstream"),
  },
  {
    name: "mempool",
    minIntervalMs: 1_000,
    url: (txid) => `https://mempool.space/api/tx/${txid}`,
    parse: (value) => integerFee(value?.fee, "mempool"),
  },
  {
    name: "blockchain",
    minIntervalMs: 10_000,
    responseType: "text",
    url: (txid) => `https://blockchain.info/q/txfee/${txid}`,
    parse: (value) => integerFee(Number(value), "blockchain"),
  },
  {
    name: "blockcypher",
    minIntervalMs: 36_000,
    url: (txid) => `https://api.blockcypher.com/v1/btc/main/txs/${txid}?limit=1`,
    parse: (value) => integerFee(value?.fees, "blockcypher"),
  },
  ...[1, 2, 3, 4, 5].map((node) => ({
    name: `trezor${node}`,
    minIntervalMs: 1_000,
    url: (txid) => `https://btc${node}.trezor.io/api/v2/tx/${txid}`,
    parse: (value) => integerFee(Number(value?.fees), `trezor${node}`),
  })),
  {
    name: "trusteeglobal",
    minIntervalMs: 1_000,
    url: (txid) => `https://btc.trusteeglobal.com/api/v2/tx/${txid}`,
    parse: (value) => integerFee(Number(value?.fees), "trusteeglobal"),
  },
  {
    name: "bitaps",
    minIntervalMs: 1_000,
    url: (txid) => `https://api.bitaps.com/btc/v1/blockchain/transaction/${txid}`,
    parse: (value) => integerFee(value?.data?.fee, "bitaps"),
  },
];

export async function fetchProviderFee(provider, txid, fetchImpl = fetch) {
  const response = await fetchImpl(provider.url(txid), { signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`${provider.name} transaction ${response.status}`);
    error.status = response.status;
    error.retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
    await response.body?.cancel();
    throw error;
  }
  const value = provider.responseType === "text" ? await response.text() : await response.json();
  return provider.parse(value);
}
