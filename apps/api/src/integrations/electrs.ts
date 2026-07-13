export interface ElectrsOutspend {
  spent: boolean;
  txid: string | null;
  block_height: number | null;
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
