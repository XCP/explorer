const ETHERSCAN_URL = "https://api.etherscan.io/v2/api";
const REQUEST_TIMEOUT_MS = 25_000;

export interface EtherscanLog {
  blockNumber: string;
  data?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEtherscanLogs(value: unknown): EtherscanLog[] {
  if (!isObject(value)) throw new Error("Etherscan logs response must be an object");
  if (!Array.isArray(value.result)) {
    const detail = typeof value.result === "string" ? `: ${value.result.slice(0, 80)}` : "";
    throw new Error(`Etherscan logs response must contain a result array${detail}`);
  }
  return value.result.map((log, index) => {
    if (!isObject(log) || typeof log.blockNumber !== "string" || !/^0x[0-9a-f]+$/i.test(log.blockNumber)) {
      throw new Error(`Etherscan log ${index} has an invalid blockNumber`);
    }
    if (log.data !== undefined && (typeof log.data !== "string" || !/^0x[0-9a-f]*$/i.test(log.data))) {
      throw new Error(`Etherscan log ${index} has invalid data`);
    }
    return { blockNumber: log.blockNumber, ...(log.data === undefined ? {} : { data: log.data }) };
  });
}

export async function fetchEtherscanMintLogs(
  apiKey: string,
  contract: string,
  topic: string,
  zeroTopic: string,
  fromBlock: number,
  pageSize: number,
): Promise<EtherscanLog[]> {
  const query = new URLSearchParams({
    chainid: "1",
    module: "logs",
    action: "getLogs",
    address: contract,
    topic0: topic,
    topic2: zeroTopic,
    topic0_2_opr: "and",
    fromBlock: String(fromBlock),
    toBlock: "latest",
    page: "1",
    offset: String(pageSize),
    apikey: apiKey,
  });
  const response = await fetch(`${ETHERSCAN_URL}?${query}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Etherscan logs request failed: ${response.status}`);
  return parseEtherscanLogs(await response.json());
}
