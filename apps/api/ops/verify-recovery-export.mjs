import process from "node:process";
import {
  classifyRecovery,
  p2pkhAddress,
  parseBareMultisig,
  verifyCounterpartyLayout,
} from "../.test-dist/src/recovery/classifier.js";
import { parseRecoveryTransaction } from "../.test-dist/src/recovery/raw-transaction.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const page = JSON.parse(input);
const counts = { recoverable: 0, spent: 0, unverified: 0, invalid: 0 };
const failures = [];

for (const row of page.transactions ?? []) {
  try {
    const transaction = parseRecoveryTransaction(row.raw_transaction_hex);
    if (transaction.txid !== row.txid) throw new Error("raw transaction hash mismatch");
    for (const candidate of row.outputs) {
      const output = transaction.output(candidate.vout);
      if (!output) throw new Error(`missing output ${candidate.vout}`);
      if (output.valueSats !== BigInt(candidate.value_sats)) throw new Error(`value mismatch at ${candidate.vout}`);
      if (output.scriptPubkeyHex !== candidate.script_pubkey_hex) throw new Error(`script mismatch at ${candidate.vout}`);
      const parsed = parseBareMultisig(candidate.script_pubkey_hex);
      if (!parsed) throw new Error(`malformed script at ${candidate.vout}`);
      const layout = verifyCounterpartyLayout(parsed, transaction.firstInputTxid);
      if (!layout) {
        counts.unverified++;
        continue;
      }
      const position = layout === "historical-1-of-2" ? 0 : 2;
      const address = p2pkhAddress(parsed.keyDataHex[position]);
      if (!address) throw new Error(`invalid recovery key at ${candidate.vout}`);
      const decision = classifyRecovery({
        scriptPubkeyHex: candidate.script_pubkey_hex,
        firstInputTxid: transaction.firstInputTxid,
        expectedAddress: address,
        spent: !!candidate.spent_by_txid,
      });
      if (decision.classification === "recoverable" || decision.classification === "spent")
        counts[decision.classification]++;
      else counts.invalid++;
    }
  } catch (error) {
    failures.push({ txid: row.txid, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify({ rows: page.rows, next_id: page.next_id, counts, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
