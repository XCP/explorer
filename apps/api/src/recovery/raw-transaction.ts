import { Transaction } from "@scure/btc-signer";
import { hex } from "@scure/base";

export interface RecoveryTransactionOutput {
  valueSats: bigint;
  scriptPubkeyHex: string;
}

export interface ParsedRecoveryTransaction {
  txid: string;
  firstInputTxid: string;
  output(index: number): RecoveryTransactionOutput | null;
}

export function parseRecoveryTransaction(rawTransactionHex: string): ParsedRecoveryTransaction {
  const transaction = Transaction.fromRaw(hex.decode(rawTransactionHex), {
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  if (transaction.inputsLength === 0) throw new Error("recovery transaction has no inputs");
  const firstInput = transaction.getInput(0);
  if (!firstInput.txid) throw new Error("recovery transaction first input has no txid");
  return {
    txid: transaction.id,
    firstInputTxid: hex.encode(firstInput.txid),
    output(index) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= transaction.outputsLength) return null;
      const output = transaction.getOutput(index);
      if (output.amount == null || !output.script) return null;
      return { valueSats: output.amount, scriptPubkeyHex: hex.encode(output.script) };
    },
  };
}
