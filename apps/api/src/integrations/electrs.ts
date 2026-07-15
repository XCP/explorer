export interface ElectrsOutspend {
  spent: boolean;
  txid: string | null;
  block_height: number | null;
}

export interface ElectrsTransactionStatus {
  confirmed: boolean;
  blockHeight: number | null;
  blockHash: string | null;
  blockTime: number | null;
}

export function parseElectrsTransactionFee(value: unknown): number {
  const transaction = object(value, "Electrs transaction must be an object");
  if (!Number.isSafeInteger(transaction.fee) || Number(transaction.fee) < 0)
    throw new Error("Electrs transaction has an invalid fee");
  return Number(transaction.fee);
}

export function parseElectrsTransactionHex(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value))
    throw new Error("Electrs transaction hex is invalid");
  return value.toLowerCase();
}

export interface ElectrsBlockSummary {
  height: number;
  transactionCount: number;
}

export function parseElectrsBlockPage(value: unknown): ElectrsBlockSummary[] {
  if (!Array.isArray(value)) throw new Error("Electrs block page must be an array");
  return value.map((item) => {
    const block = object(item, "Electrs block summary must be an object");
    if (!Number.isSafeInteger(block.height) || Number(block.height) < 0)
      throw new Error("Electrs block summary has an invalid height");
    if (!Number.isSafeInteger(block.tx_count) || Number(block.tx_count) < 0)
      throw new Error("Electrs block summary has an invalid transaction count");
    return { height: Number(block.height), transactionCount: Number(block.tx_count) };
  });
}

export async function fetchBlockPage(baseUrl: string, height: number): Promise<ElectrsBlockSummary[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/blocks/${height}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Electrs blocks ${response.status}`);
  return parseElectrsBlockPage(await response.json());
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

export function parseElectrsTransactionStatus(value: unknown): ElectrsTransactionStatus {
  const transaction = object(value, "Electrs transaction must be an object");
  const status = object(transaction.status, "Electrs transaction status must be an object");
  if (typeof status.confirmed !== "boolean") throw new Error("Electrs transaction status is missing confirmed state");
  const confirmed = status.confirmed;
  if (
    confirmed &&
    (!Number.isSafeInteger(status.block_height) ||
      Number(status.block_height) < 0 ||
      typeof status.block_hash !== "string" ||
      !/^[0-9a-f]{64}$/i.test(status.block_hash) ||
      !Number.isSafeInteger(status.block_time) ||
      Number(status.block_time) < 0)
  )
    throw new Error("confirmed Electrs transaction is missing block evidence");
  return {
    confirmed,
    blockHeight: confirmed && Number.isSafeInteger(status.block_height) ? Number(status.block_height) : null,
    blockHash: confirmed && typeof status.block_hash === "string" ? status.block_hash : null,
    blockTime: confirmed && Number.isSafeInteger(status.block_time) ? Number(status.block_time) : null,
  };
}

export function parseElectrsOutspends(value: unknown): ElectrsOutspend[] {
  if (!Array.isArray(value)) throw new Error("Electrs outspends response must be an array");
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("invalid Electrs outspend");
    const row = item as Record<string, unknown>;
    if (typeof row.spent !== "boolean") throw new Error("Electrs outspend is missing spent state");
    const status =
      typeof row.status === "object" && row.status !== null ? (row.status as Record<string, unknown>) : null;
    return {
      spent: row.spent,
      txid: row.spent && typeof row.txid === "string" ? row.txid : null,
      block_height:
        row.spent && status?.confirmed === true && Number.isSafeInteger(status.block_height)
          ? Number(status.block_height)
          : null,
    };
  });
}

export async function fetchTransactionOutspends(baseUrl: string, txid: string): Promise<ElectrsOutspend[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/tx/${encodeURIComponent(txid)}/outspends`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Electrs outspends ${response.status}`);
  return parseElectrsOutspends(await response.json());
}

export async function fetchTransactionStatus(baseUrl: string, txid: string): Promise<ElectrsTransactionStatus | null> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/tx/${encodeURIComponent(txid)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Electrs transaction ${response.status}`);
  return parseElectrsTransactionStatus(await response.json());
}

export async function fetchTransactionFee(baseUrl: string, txid: string): Promise<number | null> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/tx/${encodeURIComponent(txid)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Electrs transaction ${response.status}`);
  return parseElectrsTransactionFee(await response.json());
}

export async function fetchTransactionHex(baseUrl: string, txid: string): Promise<string | null> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/tx/${encodeURIComponent(txid)}/hex`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Electrs transaction hex ${response.status}`);
  return parseElectrsTransactionHex(await response.text());
}

export async function fetchTipHeight(baseUrl: string): Promise<number> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/blocks/tip/height`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Electrs tip height ${response.status}`);
  const height = Number(await response.text());
  if (!Number.isSafeInteger(height) || height < 0) throw new Error("Electrs returned an invalid tip height");
  return height;
}
