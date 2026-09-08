import { discard } from "#api/lib/net";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BODY_CHARS = 262_144;

/** Preserve the existing text prefix without reading the rest of a remote document. */
async function readMetadataPrefix(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  // UTF-8 needs at most three bytes per UTF-16 code unit, plus an optional BOM.
  const maxBytes = MAX_BODY_CHARS * 3 + 3;
  let bytes = 0;
  let text = "";
  let complete = false;
  try {
    while (text.length < MAX_BODY_CHARS && bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        return (text + decoder.decode()).slice(0, MAX_BODY_CHARS);
      }
      const prefix = value.subarray(0, maxBytes - bytes);
      bytes += prefix.byteLength;
      text += decoder.decode(prefix, { stream: true });
    }
    return text.slice(0, MAX_BODY_CHARS);
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface ExternalMetadataResult {
  text: string | null;
  lastStatus: number;
}

export async function fetchExternalMetadata(urls: string[]): Promise<ExternalMetadataResult> {
  let lastStatus = 0;
  for (const url of urls) {
    const attempts = /arweave\.net\/|\.ar\.io\//i.test(url) ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "user-agent": "xcp.io/1.0", accept: "application/json,*/*" },
      }).catch(() => null);
      if (response?.ok) return { text: await readMetadataPrefix(response), lastStatus };
      if (response) {
        lastStatus = response.status;
        // Arweave gateways get three attempts; without this each failed one
        // holds a connection while the next is made.
        await discard(response);
      }
    }
  }
  return { text: null, lastStatus };
}
