const EMBLEM_METADATA_URL = "https://v2.emblemvault.io/meta";
const REQUEST_TIMEOUT_MS = 20_000;

export interface EmblemMetadataValue {
  coin?: string;
  balance?: string | number;
}

export interface EmblemMetadata {
  name?: string;
  values?: EmblemMetadataValue[];
  fraud?: boolean;
  addresses?: Array<{ coin?: string; address?: string }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEmblemMetadata(value: unknown): EmblemMetadata {
  if (!isObject(value)) throw new Error("Emblem metadata response must be an object");
  if (value.name !== undefined && typeof value.name !== "string") {
    throw new Error("Emblem metadata name must be a string");
  }
  if (value.fraud !== undefined && typeof value.fraud !== "boolean") {
    throw new Error("Emblem metadata fraud must be a boolean");
  }
  if (value.values !== undefined) {
    if (!Array.isArray(value.values)) throw new Error("Emblem metadata values must be an array");
    for (const [index, item] of value.values.entries()) {
      if (!isObject(item)) throw new Error(`Emblem metadata value ${index} must be an object`);
      if (item.coin !== undefined && typeof item.coin !== "string") {
        throw new Error(`Emblem metadata value ${index} coin must be a string`);
      }
      if (item.balance !== undefined && typeof item.balance !== "string" && typeof item.balance !== "number") {
        throw new Error(`Emblem metadata value ${index} balance must be a string or number`);
      }
      if (typeof item.balance === "number" && !Number.isFinite(item.balance)) {
        throw new Error(`Emblem metadata value ${index} balance must be finite`);
      }
    }
  }
  if (value.addresses !== undefined) {
    if (!Array.isArray(value.addresses)) throw new Error("Emblem metadata addresses must be an array");
    for (const [index, item] of value.addresses.entries()) {
      if (!isObject(item)) throw new Error(`Emblem metadata address ${index} must be an object`);
      if (item.coin !== undefined && typeof item.coin !== "string") {
        throw new Error(`Emblem metadata address ${index} coin must be a string`);
      }
      if (item.address !== undefined && typeof item.address !== "string") {
        throw new Error(`Emblem metadata address ${index} address must be a string`);
      }
    }
  }
  return value as EmblemMetadata;
}

export async function fetchEmblemMetadata(
  tokenId: string,
  options: { headers?: Record<string, string>; acceptNotFound?: boolean } = {},
): Promise<EmblemMetadata> {
  const response = await fetch(`${EMBLEM_METADATA_URL}/${encodeURIComponent(tokenId)}`, {
    headers: { accept: "application/json", ...options.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404 && options.acceptNotFound !== false) return {};
  if (!response.ok) throw new Error(`Emblem metadata request failed: ${response.status}`);
  return parseEmblemMetadata(await response.json());
}
