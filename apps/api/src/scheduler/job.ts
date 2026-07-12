export interface ScheduledJobEvent {
  event: "scheduled_job";
  job: string;
  outcome: "success" | "error";
  duration_ms: number;
  error?: { name: string; message: string };
}

function errorDetails(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: String(error) };
}

/** Run one cron unit with consistent timing and failure isolation. */
export async function runScheduledJob<T>(job: string, run: () => Promise<T>): Promise<T | undefined> {
  const startedAt = Date.now();
  try {
    const result = await run();
    console.log({
      event: "scheduled_job",
      job,
      outcome: "success",
      duration_ms: Date.now() - startedAt,
    } satisfies ScheduledJobEvent);
    return result;
  } catch (error) {
    console.error({
      event: "scheduled_job",
      job,
      outcome: "error",
      duration_ms: Date.now() - startedAt,
      error: errorDetails(error),
    } satisfies ScheduledJobEvent);
    return undefined;
  }
}
