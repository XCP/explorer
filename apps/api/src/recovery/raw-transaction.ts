import { Transaction } from "@scure/btc-signer";
import { hex } from "@scure/base";

export interface RecoveryTransactionOutput {
  valueSats: bigint;
  scriptPubkeyHex: string;
}

export interface ParsedRecoveryTransaction {
  txid: string;
  firstInputTxid: string;
  inputs: { txid: string; vout: number }[];
  outputs: RecoveryTransactionOutput[];
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
    inputs: Array.from({ length: transaction.inputsLength }, (_, index) => {
      const input = transaction.getInput(index);
      if (!input.txid || input.index == null) throw new Error(`recovery transaction input ${index} is incomplete`);
      return { txid: hex.encode(input.txid), vout: input.index };
    }),
    outputs: Array.from({ length: transaction.outputsLength }, (_, index) => {
      const output = transaction.getOutput(index);
      if (output.amount == null || !output.script)
        throw new Error(`recovery transaction output ${index} is incomplete`);
      return { valueSats: output.amount, scriptPubkeyHex: hex.encode(output.script) };
    }),
    output(index) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= transaction.outputsLength) return null;
      const output = transaction.getOutput(index);
      if (output.amount == null || !output.script) return null;
      return { valueSats: output.amount, scriptPubkeyHex: hex.encode(output.script) };
    },
  };
}
