-- Documented Tokenly Swapbot vending addresses. Behavioral discovery alone is not
-- sufficient for this registry: every row requires contemporaneous venue evidence.
CREATE TABLE tokenly_swapbots (
  address TEXT PRIMARY KEY,
  operator TEXT,
  bot_slug TEXT,
  active_from_block INTEGER,
  active_to_block INTEGER,
  match_window_blocks INTEGER NOT NULL DEFAULT 12 CHECK(match_window_blocks BETWEEN 1 AND 24),
  confidence TEXT NOT NULL CHECK(confidence IN ('confirmed','corroborated')),
  evidence_url TEXT NOT NULL,
  evidence_note TEXT NOT NULL
) WITHOUT ROWID;

INSERT INTO tokenly_swapbots(
  address,operator,bot_slug,active_from_block,active_to_block,confidence,evidence_url,evidence_note
) VALUES
  ('12sfan5Kf1X1o3WcyfGiWberCkgrveGF74','spellsofgenesis','mountaingox',381076,401165,
   'confirmed','https://forums.counterparty.io/t/transaction-with-bitcrystals-goxcard-problem/1619',
   'Contemporaneous buyer report names the Tokenly bot URL, exact vending address, 250 BCY payment and transaction.'),
  ('12xu92LhzgRv8ZH4ZhsqTkfXiKE4DaVMFX','CrystalHeaven','sog-card-addict-central',383233,405415,
   'confirmed','https://bitcointalk.org/index.php?topic=957797.520',
   'Contemporaneous buyer report names the Tokenly bot URL, exact vending address and accepted payment assets.');

-- Accepted Counterparty payment assets are a separate part of the evidence contract.
-- BTC inputs live on the Bitcoin chain and will be reconstructed independently.
CREATE TABLE tokenly_swapbot_inputs (
  address TEXT NOT NULL,
  asset TEXT NOT NULL,
  PRIMARY KEY(address,asset),
  FOREIGN KEY(address) REFERENCES tokenly_swapbots(address) ON DELETE CASCADE
) WITHOUT ROWID;

INSERT INTO tokenly_swapbot_inputs(address,asset) VALUES
  ('12sfan5Kf1X1o3WcyfGiWberCkgrveGF74','BITCRYSTALS'),
  ('12xu92LhzgRv8ZH4ZhsqTkfXiKE4DaVMFX','BITCRYSTALS'),
  ('12xu92LhzgRv8ZH4ZhsqTkfXiKE4DaVMFX','XCP'),
  ('12xu92LhzgRv8ZH4ZhsqTkfXiKE4DaVMFX','GEMZ'),
  ('12xu92LhzgRv8ZH4ZhsqTkfXiKE4DaVMFX','SJCX'),
  ('12xu92LhzgRv8ZH4ZhsqTkfXiKE4DaVMFX','FLDC');
