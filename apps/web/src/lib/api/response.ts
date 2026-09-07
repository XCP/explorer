import { discard } from "@/lib/net";

export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // A Worker holds only six outbound connections; an unread body keeps its
    // slot until collection. This is the failure path of every server-rendered
    // read in the app, so leaking here is what turns one struggling upstream
    // into cancelled responses on unrelated requests. See lib/net.ts.
    await discard(response);
    throw new ApiResponseError(response.status, `API ${response.status} ${response.statusText}`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    // A body that began streaming and then failed to parse is still open.
    await discard(response);
    throw new ApiResponseError(response.status, "API returned an invalid JSON response");
  }
}
