import assert from "node:assert/strict";
import { test } from "node:test";
import { BITCOIN_FEE_PROVIDERS, fetchProviderFee } from "#ops/lib/bitcoin-fee-providers";

const txid = "ab".repeat(32);

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": typeof body === "string" ? "text/plain" : "application/json" },
  });
}

test("fee providers encode their documented response shapes and pacing", async () => {
  const byName = Object.fromEntries(BITCOIN_FEE_PROVIDERS.map((provider) => [provider.name, provider]));
  assert.equal(await fetchProviderFee(byName.counterparty, txid, async () => response({ fee: 1_200 })), 1_200);
  assert.equal(await fetchProviderFee(byName.blockstream, txid, async () => response({ fee: 1_200 })), 1_200);
  assert.equal(await fetchProviderFee(byName.mempool, txid, async () => response({ fee: 1_200 })), 1_200);
  assert.equal(await fetchProviderFee(byName.blockchain, txid, async () => response("1200")), 1_200);
  assert.equal(await fetchProviderFee(byName.blockcypher, txid, async () => response({ fees: 1_200 })), 1_200);
  assert.equal(await fetchProviderFee(byName.trezor1, txid, async () => response({ fees: "1200" })), 1_200);
  assert.equal(await fetchProviderFee(byName.trusteeglobal, txid, async () => response({ fees: "1200" })), 1_200);
  assert.equal(await fetchProviderFee(byName.bitaps, txid, async () => response({ data: { fee: 1_200 } })), 1_200);
  assert.equal(byName.blockchain.minIntervalMs, 10_000);
  assert.equal(byName.blockcypher.minIntervalMs, 36_000);
  assert.equal(BITCOIN_FEE_PROVIDERS.length, 12);
});
