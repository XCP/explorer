/** Read-time tuning for Conviction and descriptive address personas. */
export type Transform = "log" | "linear";

export interface Factor {
  key: string;
  weight: number;
  transform: Transform;
  label: string;
  why: string;
}

export const SCALARS = { scarcityOffset: 3.5 };

/** Holder participation and scarcity, separate from market-price evidence and Address Reputation. */
export const CONVICTION_FACTORS: Factor[] = [
  {
    key: "avg_holder_dex",
    weight: 2,
    transform: "log",
    label: "sophistication",
    why: "held by active DEX traders",
  },
  {
    key: "pct_creator_holders",
    weight: 1.5,
    transform: "linear",
    label: "creator_held",
    why: "held by proven creators",
  },
  {
    key: "__circulating_scarcity",
    weight: 1.5,
    transform: "linear",
    label: "scarcity",
    why: "small burn-adjusted circulating supply",
  },
  {
    key: "holder_breadth",
    weight: 1,
    transform: "log",
    label: "holder_depth",
    why: "held by deep collectors",
  },
  {
    key: "holders",
    weight: 0.5,
    transform: "log",
    label: "distribution",
    why: "distributed across holders",
  },
  {
    key: "top1_pct",
    weight: -0.6,
    transform: "linear",
    label: "concentration",
    why: "penalizes single-holder concentration",
  },
];

// Calibrated 2026-07-16 over clean assets with holders.
export const CONVICTION_PCT = { floor: 2, p50: 5, p90: 16.86, p99: 22.56, max: 28.1 };

export const TAG = {
  creatorSurvived: 20,
  collectorHeld: 100,
  merchantDispenses: 5,
  whaleXcp: 50_000,
  whaleHeld: 500,
  burnerAssets: 3,
  stampCreator: 5,
  stampCollector: 20,
};

/** Dominant-role classifier thresholds. These affect persona labels, never Reputation. */
export const PERSONA = {
  creatorFloor: 1,
  merchantFloor: 5,
  traderFloor: 10,
  collectorFloor: 10,
  creatorCap: 20,
  merchantCap: 50,
  traderCap: 100,
  collectorCap: 150,
  secondaryRatio: 0.6,
};
