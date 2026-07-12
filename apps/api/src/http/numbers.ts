export interface IntegerBounds {
  defaultValue: number;
  min?: number;
  max?: number;
}

/** Parse a whole decimal integer and clamp it; malformed input uses the explicit default. */
export function boundedInteger(value: string | undefined, bounds: IntegerBounds): number {
  const { defaultValue, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = bounds;
  const candidate = value?.trim();
  if (!candidate || !/^-?\d+$/.test(candidate)) return defaultValue;
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}

export function optionalBoundedInteger(
  value: string | undefined,
  bounds: Omit<IntegerBounds, "defaultValue"> = {},
): number | undefined {
  if (value === undefined) return undefined;
  const missing = Number.NaN;
  const parsed = boundedInteger(value, { ...bounds, defaultValue: missing });
  return Number.isNaN(parsed) ? undefined : parsed;
}
