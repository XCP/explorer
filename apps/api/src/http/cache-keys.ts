/** Cache keys are wire-schema identifiers shared by readers and background refreshers. */
export const networkStatsCacheKey = (includeHidden: boolean): string =>
  `stats:fee-completeness:${includeHidden ? 1 : 0}`;
