import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface HttpErrorDescription {
  status: ContentfulStatusCode;
  publicMessage: string;
  internal: { name: string; message: string; stack?: string };
}

export function describeHttpError(error: unknown): HttpErrorDescription {
  const expected = error instanceof HTTPException;
  const internal = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "UnknownError", message: String(error) };

  return {
    status: expected ? error.status : 500,
    publicMessage: expected ? error.message : "Internal Server Error",
    internal,
  };
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestId(incoming: string | undefined): string {
  return incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}
