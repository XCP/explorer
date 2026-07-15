export interface ScheduledJobEvent {
  event: "scheduled_job";
  job: string;
  outcome: "success" | "error";
  duration_ms: number;
  progress?: Record<string, number | boolean | null>;
  error?: { name: string; message: string };
}

/** Retain only bounded scalar progress. Provider payloads, hashes, and arbitrary strings never enter logs. */
function progressDetails(value: unknown): Record<string, number | boolean | null> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const progress: Record<string, number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) progress[key] = item;
    else if (typeof item === "boolean" || item === null) progress[key] = item;
    else if (Array.isArray(item)) progress[`${key}_count`] = item.length;
  }
  return Object.keys(progress).length ? progress : undefined;
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
      progress: progressDetails(result),
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
