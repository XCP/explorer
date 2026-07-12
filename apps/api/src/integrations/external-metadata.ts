const REQUEST_TIMEOUT_MS = 8_000;
const MAX_BODY_CHARS = 262_144;

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
      if (response?.ok) return { text: (await response.text()).slice(0, MAX_BODY_CHARS), lastStatus };
      if (response) lastStatus = response.status;
    }
  }
  return { text: null, lastStatus };
}
