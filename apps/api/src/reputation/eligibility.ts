/**
 * Shared integrity boundary for products that rank or recommend assets.
 *
 * Rating intentionally does not use this predicate: it keeps the historical evidence visible and applies a
 * low-quality tier cap. Tags and stats may also include low-quality rows when their contract is descriptive.
 */
export const assetRankingEligibleSql = (alias: string): string => `COALESCE(${alias}.low_quality,0)=0`;

export const assetRankingEligible = (lowQuality: number | null | undefined): boolean => lowQuality !== 1;
