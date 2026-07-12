const REQUEST_TIMEOUT_MS = 25_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAlchemyRpcResult(value: unknown): unknown {
  if (!isObject(value)) throw new Error("Alchemy RPC response must be an object");
  if (value.error !== undefined) {
    const message =
      isObject(value.error) && typeof value.error.message === "string" ? value.error.message : "unknown error";
    throw new Error(`Alchemy RPC error: ${message.slice(0, 120)}`);
  }
  if (!("result" in value)) throw new Error("Alchemy RPC response has no result");
  return value.result;
}

export async function callAlchemyRpc(apiKey: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Alchemy RPC request failed: ${response.status}`);
  return parseAlchemyRpcResult(await response.json());
}
