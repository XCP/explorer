export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Body exceeds ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

/** Enforce the actual UTF-8 byte budget before decoding or parsing untrusted input. */
export async function readBoundedText(source: Request | Response, maxBytes: number): Promise<string> {
  const reader = source.body?.getReader();
  if (!reader) return "";
  let complete = false;
  try {
    const declared = source.headers.get("content-length");
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
      throw new BodyTooLargeError(maxBytes);
    }
    let bytes = new Uint8Array(Math.min(maxBytes, 16_384));
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        return new TextDecoder().decode(bytes.subarray(0, size));
      }
      const nextSize = size + value.byteLength;
      if (nextSize > maxBytes) throw new BodyTooLargeError(maxBytes);
      if (nextSize > bytes.byteLength) {
        const grown = new Uint8Array(Math.min(maxBytes, Math.max(nextSize, bytes.byteLength * 2)));
        grown.set(bytes.subarray(0, size));
        bytes = grown;
      }
      bytes.set(value, size);
      size = nextSize;
    }
  } finally {
    // Cancellation can stay pending for a stalled source or a tee's other branch.
    // Initiate it, handle failure, and release our lock without delaying the response.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
