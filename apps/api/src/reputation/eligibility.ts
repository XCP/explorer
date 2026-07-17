/**
 * Shared integrity boundary for products that rank or recommend assets.
 *
 * Rating uses this predicate to withhold a numeric value for reviewed integrity cases. Tags and descriptive
 * statistics may still include those rows while clearly reporting their integrity status.
 */
export const assetRankingEligibleSql = (alias: string): string => `COALESCE(${alias}.low_quality,0)=0`;

export const assetRankingEligible = (lowQuality: number | null | undefined): boolean => lowQuality !== 1;
