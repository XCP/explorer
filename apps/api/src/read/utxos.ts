/**
 * /v2/utxos/:utxo — one UTXO holder ("txid:vout"): attached balances, controlling address, and the
 * attach/move/detach history. Thin route over queries/utxos.ts. States: attached (live balances),
 * or a historical holder whose last event says where the assets went.
 */
import type { Envelope } from "@xcp/shared/envelope";
import type { UtxoDetail } from "@xcp/shared/utxos";
import { router, J } from "#api/read/respond";
import { utxoBalances, utxoController, utxoHistory } from "#api/queries/utxos";

const UTXO_SHAPE = /^([0-9a-fA-F]{64}):(0|[1-9][0-9]*)$/;

const hashBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(32);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

export const utxos = router();

utxos.get("/v2/utxos/:utxo", async (c) => {
  const raw = decodeURIComponent(c.req.param("utxo"));
  const match = UTXO_SHAPE.exec(raw);
  if (!match) return c.json({ error: "expected txid:vout" }, 400);
  const utxo = `${match[1]!.toLowerCase()}:${match[2]!}`;
  const db = c.env.CORE_DB;
  const [balances, controller, history] = await Promise.all([
    utxoBalances(db, hashBytes(match[1]!), Number(match[2]!)),
    utxoController(db, hashBytes(match[1]!), Number(match[2]!)),
    utxoHistory(db, utxo),
  ]);
  if (!balances.length && !history.length) return c.json({ error: "unknown utxo" }, 404);
  // Not attached anymore? The last event that names a controlling party is the best owner answer.
  const lastKnown = [...history]
    .reverse()
    .map((event) => event.destination_address || event.source_address)
    .find((address) => address != null);
  const body: Envelope<UtxoDetail> = {
    result: {
      utxo,
      address: controller?.address ?? lastKnown ?? null,
      attached: balances.length > 0,
      balances,
      history,
    },
  };
  return J(c, body, 60);
});
