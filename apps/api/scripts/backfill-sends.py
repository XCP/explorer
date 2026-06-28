"""
Backfill sends table from local cp_events.db into D1.
"""
import sqlite3, json, os, time, requests

CP_DB = r"C:\Users\laptop\Documents\GitHub\counterparty-sim\data\cp_events.db"
CF_ACCOUNT = "bbeb864fc7ab0be8d9d02143de8cfb12"
D1_DB_ID = "c30d6223-aee2-4ee5-a9a2-e6ff2ce3dede"

env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
CF_TOKEN = None
for line in open(env_path):
    if line.startswith("CLOUDFLARE_API_TOKEN="):
        CF_TOKEN = line.split("=", 1)[1].strip().strip('"')
        break

D1_URL = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/d1/database/{D1_DB_ID}/query"
HEADERS = {"Authorization": f"Bearer {CF_TOKEN}", "Content-Type": "application/json"}
BATCH = 200  # Using inline SQL, no param limit

def d1_query(sql, params=None):
    body = {"sql": sql}
    if params: body["params"] = params
    for attempt in range(3):
        try:
            r = requests.post(D1_URL, headers=HEADERS, json=body, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
            else:
                raise

def main():
    conn = sqlite3.connect(CP_DB)

    # Get resume point
    result = d1_query("SELECT MAX(block_index) as mb FROM sends")
    max_block = result["result"][0]["results"][0]["mb"] or 0
    print(f"Resuming from block {max_block}")

    # Join sends with block times directly in SQLite — no memory loading
    query = """
        SELECT s.tx_hash, s.asset, s.block_index,
               json_extract(s.params, '$.source') as source,
               json_extract(s.params, '$.destination') as dest,
               json_extract(s.params, '$.quantity') as qty,
               json_extract(s.params, '$.status') as status,
               json_extract(b.params, '$.block_time') as block_time
        FROM events s
        JOIN events b ON b.event = 'NEW_BLOCK' AND b.block_index = s.block_index
        WHERE s.event IN ('SEND', 'ENHANCED_SEND', 'MPMA_SEND')
        AND s.asset IS NOT NULL
        AND s.block_index > ?
        AND json_extract(s.params, '$.status') = 'valid'
        ORDER BY s.block_index
    """

    print("Querying sends...")
    cursor = conn.execute(query, (max_block,))

    inserted = 0
    batch = []
    for tx_hash, asset, block_index, source, dest, qty, status, block_time in cursor:
        if not source or not dest or not block_time:
            continue
        batch.append((tx_hash, asset, source, dest, qty or 0, block_index, block_time))
        if len(batch) >= BATCH:
            flush(batch)
            inserted += len(batch)
            batch = []
            if inserted % 10000 < BATCH:
                print(f"  {inserted:,} inserted (block {block_index})")

    if batch:
        flush(batch)
        inserted += len(batch)

    print(f"Done. {inserted:,} sends inserted.")

def esc(s):
    return str(s).replace("'", "''")

def flush(batch):
    values = ",".join(
        f"('{esc(r[0])}','{esc(r[1])}','{esc(r[2])}','{esc(r[3])}',{r[4]},{r[5]},{r[6]})"
        for r in batch
    )
    sql = f"INSERT OR IGNORE INTO sends (tx_hash, asset, source, destination, quantity, block_index, block_time) VALUES {values}"
    d1_query(sql)

if __name__ == "__main__":
    main()
