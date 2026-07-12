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
    throw new ApiResponseError(response.status, `API ${response.status} ${response.statusText}`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiResponseError(response.status, "API returned an invalid JSON response");
  }
}
