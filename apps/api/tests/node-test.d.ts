// Minimal ambient declarations for the node:test runner + assert (we don't pull in full @types/node).
declare module "node:test" {
  // The per-test context — only the members our tests use (skip is how contract.test.ts stays hermetic).
  interface TestContext {
    skip(message?: string): void;
    diagnostic(message: string): void;
  }
  type TestFn = (t: TestContext) => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: TestFn): void;
}
declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    strictEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, regexp: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
// process is not in @cloudflare/workers-types; contract.test.ts reads process.env.LIVE_API to stay hermetic.
declare const process: { env: Record<string, string | undefined> };
// Minimal ambient for node:sqlite (graph.test.ts runs the PPR iteration SQL against an in-memory DB). Only the
// members the harness uses; the runtime feature is stable enough for our test (Node 22+ / 24).
declare module "node:sqlite" {
  interface Statement {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
}
declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
}
