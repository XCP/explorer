import type { AddressCurrentActivity } from "@xcp/shared/addresses";

const DAY = 86_400;

/** Exact timestamp-based current-activity state, kept separate from accumulated track record. */
export function addressCurrentActivity(
  lastActiveAt: number | null | undefined,
  observedAt: number | null | undefined,
): AddressCurrentActivity | null {
  if (!lastActiveAt || !observedAt) return null;
  const daysSinceActive = Math.max(0, Math.floor((observedAt - lastActiveAt) / DAY));
  return {
    last_active_at: lastActiveAt,
    days_since_active: daysSinceActive,
  };
}
