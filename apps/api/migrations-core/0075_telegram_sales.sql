CREATE TABLE telegram_imports (
  sha256 TEXT PRIMARY KEY, chat_id TEXT NOT NULL, chat_name TEXT NOT NULL, chat_url TEXT,
  first_message_at INTEGER, last_message_at INTEGER, source_messages INTEGER NOT NULL,
  imported_at INTEGER NOT NULL
);
CREATE TABLE telegram_sales (
  chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, chat_name TEXT NOT NULL,
  sold_at INTEGER NOT NULL, currency TEXT NOT NULL, total REAL NOT NULL CHECK(total>0),
  buyer_handle TEXT, seller_handle TEXT, lot_number INTEGER,
  sale_class TEXT NOT NULL CHECK(sale_class IN ('single','bundle')),
  evidence TEXT NOT NULL, import_sha256 TEXT NOT NULL,
  PRIMARY KEY(chat_id,message_id), FOREIGN KEY(import_sha256) REFERENCES telegram_imports(sha256)
) WITHOUT ROWID;
CREATE TABLE telegram_sale_legs (
  chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, leg_index INTEGER NOT NULL,
  asset TEXT NOT NULL, quantity REAL,
  PRIMARY KEY(chat_id,message_id,leg_index),
  FOREIGN KEY(chat_id,message_id) REFERENCES telegram_sales(chat_id,message_id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX idx_telegram_sales_time ON telegram_sales(sold_at DESC);
CREATE INDEX idx_telegram_legs_asset ON telegram_sale_legs(asset,chat_id,message_id);
