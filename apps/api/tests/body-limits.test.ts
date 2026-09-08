import { test } from "node:test";
import assert from "node:assert/strict";
import { BodyTooLargeError, readBoundedText } from "#api/http/body";
import { fetchExternalMetadata } from "#api/integrations/external-metadata";
import { RECOVERY_REPORT_MAX_BYTES, recoveryRead } from "#api/recovery/read";
import type { Env } from "#api/env";

const encode = (value: string) => new TextEncoder().encode(value);

function source(chunks: Uint8Array[], headers?: HeadersInit, cancel?: () => Promise<void> | void) {
  let read = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (read === chunks.length) controller.close();
        else controller.enqueue(chunks[read++]!);
      },
      cancel() {
        cancelled = true;
        return cancel?.();
      },
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(stream, { headers }), stream, state: () => ({ read, cancelled }) };
}

async function failure(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => null,
    (error: unknown) => error,
  );
}

test("body byte budget accepts the exact UTF-8 limit including split multibyte characters", async () => {
  const text = '{"value":"🪙漢字"}';
  const bytes = encode(text);
  const input = source(Array.from(bytes, (byte) => Uint8Array.of(byte)));
  assert.equal(await readBoundedText(input.response, bytes.length), text);
  assert.equal(input.stream.locked, false);
  assert.equal(input.state().cancelled, false);
});

test("missing, understated and invalid content lengths cannot bypass the actual byte budget", async () => {
  for (const length of [undefined, "1", "invalid"]) {
    const input = source([encode("1234"), encode("5"), encode("unread")], length ? { "content-length": length } : {});
    assert.ok((await failure(readBoundedText(input.response, 4))) instanceof BodyTooLargeError);
    assert.deepEqual(input.state(), { read: 2, cancelled: true });
    assert.equal(input.stream.locked, false);
  }
});

test("oversized declared bodies are cancelled before the first pull", async () => {
  const input = source([encode("unread")], { "content-length": "999999999999999999999999999" });
  assert.ok((await failure(readBoundedText(input.response, 4))) instanceof BodyTooLargeError);
  assert.deepEqual(input.state(), { read: 0, cancelled: true });
});

test("large single chunks and pending/rejected cancellation cannot delay rejection", async () => {
  for (const cancel of [() => new Promise<void>(() => {}), () => Promise.reject(new Error("cancel failed"))]) {
    const input = source([new Uint8Array(1_000_000)], {}, cancel);
    const result = await Promise.race([
      failure(readBoundedText(input.response, 4)),
      new Promise((resolve) => setTimeout(() => resolve("timed out"), 100)),
    ]);
    assert.ok(result instanceof BodyTooLargeError);
    assert.equal(input.stream.locked, false);
  }
});

test("one-byte chunks use the same byte budget and failed streams release their reader", async () => {
  const input = source(Array.from({ length: 20_000 }, () => Uint8Array.of(65)));
  assert.equal((await readBoundedText(input.response, 20_000)).length, 20_000);
  const expected = new Error("source failed");
  const broken = new ReadableStream<Uint8Array>({ pull: (controller) => controller.error(expected) });
  assert.equal(await failure(readBoundedText(new Response(broken), 4)), expected);
  assert.equal(broken.locked, false);
});

test("metadata preserves the old character prefix and cancels an oversized upstream early", async () => {
  const oldFetch = globalThis.fetch;
  try {
    for (const text of ["A".repeat(300_000), "漢".repeat(300_000), "A".repeat(262_143) + "🪙tail"]) {
      const bytes = encode(text);
      const input = source([bytes.subarray(0, 7), bytes.subarray(7), new Uint8Array(1_000_000)]);
      globalThis.fetch = async () => input.response;
      assert.equal((await fetchExternalMetadata(["https://metadata.test"])).text, text.slice(0, 262_144));
      assert.deepEqual(input.state(), { read: 2, cancelled: true });
      assert.equal(input.stream.locked, false);
    }
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("small metadata retains split UTF-8 and replacement decoding, with no truncation", async () => {
  const oldFetch = globalThis.fetch;
  const bytes = Uint8Array.from([...encode('\uFEFF{"name":"🪙漢"}'), 0xff]);
  const input = source(Array.from(bytes, (byte) => Uint8Array.of(byte)));
  try {
    globalThis.fetch = async () => input.response;
    assert.equal((await fetchExternalMetadata(["https://metadata.test"])).text, new TextDecoder().decode(bytes));
    assert.equal(input.state().cancelled, false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("metadata cancellation does not wait for an upstream that will never settle", async () => {
  const oldFetch = globalThis.fetch;
  const input = source([encode("A".repeat(300_000))], {}, () => new Promise<void>(() => {}));
  try {
    globalThis.fetch = async () => input.response;
    const result = await Promise.race([
      fetchExternalMetadata(["https://metadata.test"]),
      new Promise((resolve) => setTimeout(() => resolve(null), 100)),
    ]);
    assert.ok(result);
    assert.equal(input.stream.locked, false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

const env = {
  RECOVERY_DB: {
    prepare(sql: string) {
      assert.ok(sql.includes("read_ready"), "invalid input must not reach recovery queries or writes");
      return { first: async () => ({ value: "1" }) };
    },
  },
} as unknown as Env;

function report(stream: ReadableStream<Uint8Array>) {
  const init: RequestInit & { duplex: "half" } = { method: "POST", body: stream, duplex: "half" };
  return recoveryRead.fetch(
    new Request("https://api.test/addresses/1BitcoinEaterAddressDontSendf59kuE/recoveries", init),
    env,
  );
}

test("recovery reports return 413 before parsing an oversized chunked body", async () => {
  const input = source([new Uint8Array(RECOVERY_REPORT_MAX_BYTES), Uint8Array.of(65), encode("unread")]);
  const response = await report(input.stream);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    error: "recovery report body is too large",
    max_bytes: RECOVERY_REPORT_MAX_BYTES,
  });
  assert.deepEqual(input.state(), { read: 2, cancelled: true });
});

test("recovery reports retain malformed JSON 400 and accept the full raw transaction budget", async () => {
  assert.equal((await report(source([encode("{")]).stream)).status, 400);
  const body = JSON.stringify({ raw_transaction_hex: "00".repeat(4_000_000) });
  const padded = body.padEnd(RECOVERY_REPORT_MAX_BYTES, " ");
  const response = await report(source([encode(padded)]).stream);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "fee and output amounts must be non-negative safe integers" });
});
