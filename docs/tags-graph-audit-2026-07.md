# Tags and graph audit

## Contract

Tags are categorical discovery metadata. They are not Rating or Reputation factors merely because they exist.
Every row has an independently meaningful owner in `source`: protocol classification, computed behavior, media,
artist identity, collection evidence, or manual curation. Canonical relational fields must not be mirrored as tags.

## Controlled computed vocabulary

### Address classifications

- `exchange`, `deposit`, `burn`, `vault`, `service`: projections of explicit address classification fields.
- `vault_funder`, `vault_cracker`: observed direction around known Emblem Vault addresses.
- `dex_trader`: at least 10 lifetime DEX matches.
- `frequent_dex_trader`: at least 100 lifetime DEX matches. This deliberately does not claim recent activity.
- `collector`: at least 100 distinct currently held assets.
- `prolific_collector`: at least 500 distinct currently held assets. The former `whale` name incorrectly implied
  position size or economic value.
- `merchant`: at least five dispenses.
- `creator`: at least one issued asset reaching ten holders.
- `prolific_creator`: at least twenty issued assets reaching ten holders.
- `burner`, `dividend_payer`, `stamp_creator`, `stamp_collector`, `src20_deployer`, `btns_user`: direct behavioral
  thresholds documented in `src/indexer/tags.ts`.

### Asset classifications

- `low_quality`: the explicit `asset_signals.low_quality` classification. The former `wash` name was too narrow;
  the underlying set also covers curated junk and bridge/exchange artifacts.
- `durable`: DEX history spanning at least 43,800 blocks. It describes span, not present liquidity.
- `broad`: at least 50 current holders.
- `vaulted`: a positive balance currently belongs to a known Emblem Vault.
- `pre-ethereum`, `pre-cryptopunks`: issuance predates the named external milestone.

Protocol tags (`stamp`, `src20`, `src20_deploy`, `src721`, `src101`) remain categorical observations derived from
valid issuance descriptions. Collection and artist slugs are identities/evidence namespaces, not behavioral labels.

## Removed vocabulary

- `named`, `subasset`, `numeric`: removed because `assets.type` is canonical. Production already had five numeric
  assets missing the duplicate tag.
- `liquid`: removed because ten historical matches do not establish executable liquidity.
- `og`: removed because an arbitrary age/activity threshold labeled nearly 80,000 addresses without a defensible
  meaning.

No aliases or compatibility rows remain for removed/renamed tags.

## Graph decision

Keep the normalized relationship graph. Its 1.72 million current edges power graph exploration and holder-cohesion
analysis. Keep `graph_trust` and `graph_distrust` as standalone relationship evidence for those surfaces, but exclude
them from Address Reputation, Asset Rating, and Conviction until a frozen held-out evaluation proves incremental
value beyond ordinary behavioral features. Network reachability is not synonymous with quality or trustworthiness.
