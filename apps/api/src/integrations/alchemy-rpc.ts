const REQUEST_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 4;
const MAX_BACKOFF_MS = 8_000;

const backoffMs = (attempt: number, retryAfter = 0) => {
  const requested = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
  const bounded = Math.min(MAX_BACKOFF_MS, requested);
  // Jitter prevents every scheduled Worker invocation from retrying a recovering provider together.
  return Math.round(bounded * (0.75 + Math.random() * 0.5));
};

/** POST one JSON-RPC payload with good-citizen backoff. Alchemy meters compute units per second, so
 *  crawl loops intermittently see 429 — wait and retry instead of surfacing a one-tick soft failure. */
async function postAlchemy(apiKey: string, body: string, what: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt, retryAfter)));
      continue;
    }
    throw new Error(`${what} failed: ${response.status}`);
  }
}

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
  const body = JSON.stringify({ id: 1, jsonrpc: "2.0", method, params });
  return parseAlchemyRpcResult(await postAlchemy(apiKey, body, "Alchemy RPC request"));
}

export interface EthereumBlockTime {
  blockNumber: number;
  blockTime: number;
}

/** Validate an unordered JSON-RPC batch and bind every timestamp to the requested block identity. */
export function parseEthereumBlockTimes(blockNumbers: number[], value: unknown): EthereumBlockTime[] {
  if (!Array.isArray(value)) throw new Error("Alchemy block batch must be an array");
  const requested = new Set(blockNumbers);
  const times = new Map<number, number>();
  for (const item of value) {
    if (!isObject(item) || item.error !== undefined || !isObject(item.result))
      throw new Error("Alchemy block batch contains an error");
    const numberHex = item.result.number;
    const timestampHex = item.result.timestamp;
    if (
      typeof numberHex !== "string" ||
      !/^0x[0-9a-f]+$/i.test(numberHex) ||
      typeof timestampHex !== "string" ||
      !/^0x[0-9a-f]+$/i.test(timestampHex)
    )
      throw new Error("Alchemy block batch contains an invalid block");
    const blockNumber = Number.parseInt(numberHex, 16);
    const blockTime = Number.parseInt(timestampHex, 16);
    if (!requested.has(blockNumber) || !Number.isSafeInteger(blockTime) || blockTime <= 0)
      throw new Error("Alchemy block batch returned an unexpected block");
    times.set(blockNumber, blockTime);
  }
  if (times.size !== requested.size) throw new Error("Alchemy block batch is incomplete");
  return blockNumbers.map((blockNumber) => ({ blockNumber, blockTime: times.get(blockNumber)! }));
}

export async function fetchEthereumBlockTimes(apiKey: string, blockNumbers: number[]): Promise<EthereumBlockTime[]> {
  if (blockNumbers.length === 0) return [];
  const body = JSON.stringify(
    blockNumbers.map((blockNumber, index) => ({
      id: index + 1,
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: [`0x${blockNumber.toString(16)}`, false],
    })),
  );
  return parseEthereumBlockTimes(blockNumbers, await postAlchemy(apiKey, body, "Alchemy block batch"));
}
