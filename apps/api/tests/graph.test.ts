/**
 * Graph-reputation validation gauntlet (docs/graph-reputation.md, "Validation plan on our data"). This is the
 * ONE test that proves the sybil-resistance claim, so it runs the normalized production SQL builders
 * imported from graph-core.ts and executes them
 * against an in-memory node:sqlite DB. The only thing synthesized is the graph itself (a hand-built
 * graph_edges), so the math under test is byte-for-byte the code that runs on D1.
 *
 * The synthetic graph has: a trusted cluster (seeded, with ONE held-out legit node), a scam cluster (one
 * distrust seed), a petal-sybil (an attacker with one edge from a seed + many sybil leaves feeding it), and an
 * isolated newcomer. Asserts: (a) the held-out trusted node ranks in the top decile; (b) the sybil gains
 * ~nothing under Min-k while a plain-PPR control run inflates it into the top decile — the contrast; (c) the
 * newcomer is unscored (exactly zero), never negative.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  seedSubset,
  graphTier,
  entityPassStatements,
  entityNodeStatements,
  entityRankInitStatements,
  entitySeedApplyStatement,
  entitySeedInsertStatement,
  entityFinalizeStatements,
  ENTITY_IDENTITY_STATEMENTS,
  entityEdgeStatements,
  K,
  DISTRUST_SLOT,
  PASSES,
} from "#api/indexer/graph-core";

const CONTROL_SLOT = K + 1; // slot 4: the plain-PPR control (single vector over ALL trust seeds, no MIN).
const GENERATION = 1;

// ---- in-memory working tables (same DDL as migration 0024) ----
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT,
      UNIQUE(entity_type,entity_key));
    CREATE TABLE graph_edges(generation INTEGER,source_entity_id INTEGER,destination_entity_id INTEGER,
      weight REAL,edge_block INTEGER,PRIMARY KEY(generation,source_entity_id,destination_entity_id)) WITHOUT ROWID;
    CREATE TABLE graph_node(generation INTEGER,entity_id INTEGER,outsum REAL DEFAULT 0,insum REAL DEFAULT 0,
      PRIMARY KEY(generation,entity_id)) WITHOUT ROWID;
    CREATE TABLE graph_rank(generation INTEGER,entity_id INTEGER,slot INTEGER,score REAL DEFAULT 0,
      rank REAL DEFAULT 0,normalized_rank REAL DEFAULT 0,PRIMARY KEY(generation,entity_id,slot)) WITHOUT ROWID;
    CREATE TABLE graph_seed(generation INTEGER,entity_id INTEGER,slot INTEGER,score REAL,
      PRIMARY KEY(generation,entity_id,slot)) WITHOUT ROWID;
    CREATE TABLE graph_inflow(generation INTEGER,entity_id INTEGER,value REAL,
      PRIMARY KEY(generation,entity_id)) WITHOUT ROWID;
  `);
  return db;
}

/** Pick a deterministic node name that the production k-split (seedSubset) routes to subset j. */
function nameForSubset(j: number): string {
  for (let i = 0; ; i++) {
    const n = `seed_${j}_${i}`;
    if (seedSubset(n) === j) return n;
  }
}

// ---- synthetic graph builder ----
interface Graph {
  trustSeeds: string[];
  distrustSeed: string;
  heldOutTrusted: string;
  heldOutScam: string;
  attacker: string;
  petals: string[];
  newcomer: string;
}

function buildSyntheticGraph(db: DatabaseSync): Graph {
  const insertEntity = db.prepare(`INSERT OR IGNORE INTO entity_dictionary(entity_type,entity_key) VALUES('address',?)`);
  const selectEntity = db.prepare(`SELECT entity_id FROM entity_dictionary WHERE entity_type='address' AND entity_key=?`);
  const id = (name: string): number => {
    insertEntity.run(name);
    return selectEntity.get(name)!.entity_id as number;
  };
  const edge = db.prepare(
    `INSERT OR IGNORE INTO graph_edges(generation,source_entity_id,destination_entity_id,weight) VALUES(?,?,?,1.0)`,
  );
  const dir = (a: string, b: string) => edge.run(GENERATION, id(a), id(b));
  const bi = (a: string, b: string) => {
    dir(a, b);
    dir(b, a);
  };

  // one guaranteed trust seed per subset, so the trusted cluster is reachable from ALL k subsets (a MIN>0).
  const trustSeeds = [nameForSubset(0), nameForSubset(1), nameForSubset(2)];

  // trusted cluster T1..T5 (densely, bidirectionally connected); T5 is HELD OUT (not a seed).
  const T = ["T1", "T2", "T3", "T4", "T5"];
  bi("T1", "T2");
  bi("T2", "T3");
  bi("T3", "T4");
  bi("T4", "T5");
  bi("T1", "T3");
  bi("T3", "T5");
  bi("T1", "T4");
  for (const s of trustSeeds) dir(s, "T1"); // each seed vouches into the cluster

  // petal-sybil: attacker A0 with ONE attack edge from a seed, fed by many sybil leaves (petals). Classic
  // rank-pump under plain PageRank; must be neutralized by Min-k (the seed is in exactly one subset).
  const attacker = "A0";
  const attackSeed = trustSeeds[0];
  dir(attackSeed, attacker);
  const petals = ["P1", "P2", "P3", "P4", "P5"];
  for (const p of petals) dir(p, attacker);

  // scam cluster SC1..SC4 (bidirectional, disconnected from the trusted region); SC1 is the distrust seed,
  // SC4 is held out — Anti-TrustRank should still flag it.
  const distrustSeed = "SC1";
  bi("SC1", "SC2");
  bi("SC2", "SC3");
  bi("SC3", "SC4");
  bi("SC1", "SC3");

  // noise: 100 disconnected nodes with deterministic random edges among THEMSELVES (unreached by any seed) —
  // padding so "top decile" is a meaningful cut.
  let rng = 987654321;
  const rnd = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const Z = Array.from({ length: 100 }, (_, i) => `Z${i}`);
  for (let i = 0; i < 200; i++) {
    const a = Z[Math.floor(rnd() * Z.length)],
      b = Z[Math.floor(rnd() * Z.length)];
    if (a !== b) dir(a, b);
  }

  // isolated newcomer: NO edges at all -> never enters graph_node -> unscored.
  const newcomer = "N1";

  void T;
  return { trustSeeds, distrustSeed, heldOutTrusted: "T5", heldOutScam: "SC4", attacker, petals, newcomer };
}

// ---- run the PRODUCTION build + iteration over the synthetic edges ----
function run(db: DatabaseSync, g: Graph): void {
  for (const sql of entityNodeStatements(GENERATION)) db.exec(sql);
  for (const sql of entityRankInitStatements(GENERATION)) db.exec(sql);
  db.exec(`INSERT INTO graph_rank(generation,entity_id,slot,score,rank,normalized_rank)
    SELECT ${GENERATION},entity_id,${CONTROL_SLOT},0,0,0 FROM graph_node WHERE generation=${GENERATION}`);

  // teleport vectors. trust seeds split k ways by the production seedSubset(); distrust -> slot K; the control
  // vector -> slot K+1 teleports uniformly to ALL trust seeds at once (the un-hardened plain-PPR baseline).
  const subsets: string[][] = Array.from({ length: K }, () => []);
  for (const s of g.trustSeeds) subsets[seedSubset(s)].push(s);
  const seed = db.prepare(`INSERT OR REPLACE INTO graph_seed(generation,entity_id,slot,score)
    SELECT ${GENERATION},entity_id,?,? FROM entity_dictionary WHERE entity_type='address' AND entity_key=?`);
  subsets.forEach((sub, slot) => {
    const s = sub.length ? 1 / sub.length : 0;
    for (const n of sub) seed.run(slot, s, n);
  });
  seed.run(DISTRUST_SLOT, 1, g.distrustSeed);
  const cs = 1 / g.trustSeeds.length;
  for (const s of g.trustSeeds) seed.run(CONTROL_SLOT, cs, s);
  db.exec(entitySeedApplyStatement(GENERATION));

  // ~20 power-iteration passes; each slot advances independently (order across slots is irrelevant).
  for (let p = 0; p < PASSES; p++) {
    for (let slot = 0; slot <= K; slot++)
      for (const sql of entityPassStatements(GENERATION, slot, slot === DISTRUST_SLOT)) db.exec(sql);
    for (const sql of entityPassStatements(GENERATION, CONTROL_SLOT, false)) db.exec(sql);
  }
}

// ---- result extraction ----
type Map0 = Map<string, number>;
function vectors(db: DatabaseSync) {
  const trustSlots = Array.from({ length: K }, (_, i) => i).join(",");
  const trust: Map0 = new Map();
  for (const r of db
    .prepare(`SELECT entity.entity_key node,MIN(rank.rank) tr FROM graph_rank rank
      JOIN entity_dictionary entity ON entity.entity_id=rank.entity_id
      WHERE rank.generation=${GENERATION} AND rank.slot IN (${trustSlots}) GROUP BY rank.entity_id`)
    .all())
    trust.set(r.node as string, r.tr as number);
  const distrust: Map0 = new Map();
  for (const r of db.prepare(`SELECT entity.entity_key node,rank.rank dr FROM graph_rank rank
    JOIN entity_dictionary entity ON entity.entity_id=rank.entity_id
    WHERE rank.generation=${GENERATION} AND rank.slot=${DISTRUST_SLOT}`).all())
    distrust.set(r.node as string, r.dr as number);
  const plain: Map0 = new Map();
  for (const r of db.prepare(`SELECT entity.entity_key node,rank.rank pr FROM graph_rank rank
    JOIN entity_dictionary entity ON entity.entity_id=rank.entity_id
    WHERE rank.generation=${GENERATION} AND rank.slot=${CONTROL_SLOT}`).all())
    plain.set(r.node as string, r.pr as number);
  return { trust, distrust, plain };
}
const rankOf = (m: Map0, node: string): number =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).findIndex(([n]) => n === node) + 1;

/* ---------------------------------------------------------------------------------------------------- */

test("k-split is deterministic and covers all k subsets", () => {
  assert.equal(seedSubset("RAREPEPE"), seedSubset("RAREPEPE"), "same key -> same subset");
  const seeds = [nameForSubset(0), nameForSubset(1), nameForSubset(2)];
  assert.deepEqual(
    seeds.map((s) => seedSubset(s)),
    [0, 1, 2],
    "one seed lands in each of the 3 subsets",
  );
});

test("gauntlet: held-out trusted node ranks in the top decile", () => {
  const db = freshDb();
  const g = buildSyntheticGraph(db);
  run(db, g);
  const { trust } = vectors(db);
  const N = trust.size;
  const decile = Math.ceil(0.1 * N);
  const rank = rankOf(trust, g.heldOutTrusted);
  assert(trust.get(g.heldOutTrusted)! > 0, "held-out trusted node is reached by all subsets (MIN>0)");
  assert(rank <= decile, `held-out ${g.heldOutTrusted} rank ${rank} must be within top decile (<=${decile} of ${N})`);
  db.close();
});

test("gauntlet: petal-sybil gains ~nothing under Min-k, but plain-PPR inflates it (the contrast)", (t) => {
  const db = freshDb();
  const g = buildSyntheticGraph(db);
  run(db, g);
  const { trust, plain } = vectors(db);
  const N = trust.size;
  const decile = Math.ceil(0.1 * N);

  const minkA0 = trust.get(g.attacker)!;
  const plainA0 = plain.get(g.attacker)!;
  const minkRank = rankOf(trust, g.attacker);
  const plainRank = rankOf(plain, g.attacker);
  const minkT5 = trust.get(g.heldOutTrusted)!;

  t.diagnostic(
    `sybil A0  Min-k trust=${minkA0.toExponential(3)} (rank ${minkRank}/${N})  plain-PPR=${plainA0.toExponential(3)} (rank ${plainRank}/${N})`,
  );
  t.diagnostic(
    `held-out legit T5 Min-k trust=${minkT5.toExponential(3)};  contrast plainA0/minkA0 = ${minkA0 > 0 ? (plainA0 / minkA0).toFixed(1) : "∞"}`,
  );

  // (b1) Min-k neutralizes the sybil: it is reached by only ONE seed subset, so the component-wise MIN is 0.
  assert.equal(minkA0, 0, "sybil earns exactly 0 trust under Min-k (near only one seed subset)");
  // (b2) the plain-PPR control DOES reward it (this is the inflation Min-k removes).
  assert(plainA0 > 0, "plain PPR gives the sybil positive trust");
  assert(plainRank <= decile, `plain PPR inflates the sybil into the top decile (rank ${plainRank} <= ${decile})`);
  // (b3) under Min-k a legit held-out node beats the sybil (which plain PPR cannot guarantee).
  assert(minkT5 > minkA0, "held-out legit node outranks the sybil under Min-k");
  // every petal leaf is worthless in BOTH runs (they carry no seed mass).
  for (const p of g.petals) {
    assert.equal(trust.get(p) ?? 0, 0, `petal ${p} has 0 Min-k trust`);
    assert.equal(plain.get(p) ?? 0, 0, `petal ${p} has 0 plain trust`);
  }
  db.close();
});

test("gauntlet: isolated newcomer is unscored (zero, not negative)", () => {
  const db = freshDb();
  const g = buildSyntheticGraph(db);
  run(db, g);
  const { trust, distrust } = vectors(db);
  // never entered the graph at all -> no node row.
  const present = db.prepare(`SELECT COUNT(*) c FROM graph_node node JOIN entity_dictionary entity
    ON entity.entity_id=node.entity_id WHERE entity.entity_key=?`).get(g.newcomer)!.c as number;
  assert.equal(present, 0, "newcomer has no edges -> absent from graph_node");
  const t = trust.get(g.newcomer) ?? 0,
    d = distrust.get(g.newcomer) ?? 0;
  assert.equal(t, 0, "newcomer trust is 0");
  assert.equal(d, 0, "newcomer distrust is 0");
  assert(t >= 0 && d >= 0, "scores are never negative");
  assert.equal(graphTier(t, d), "unscored", "newcomer tier is unscored");
});

test("gauntlet: reverse-graph Anti-TrustRank flags the held-out scam node as distrusted", () => {
  const db = freshDb();
  const g = buildSyntheticGraph(db);
  run(db, g);
  const { trust, distrust } = vectors(db);
  const sc = g.heldOutScam;
  assert(distrust.get(sc)! > 0, "held-out scam node is reached by the reverse-graph run");
  assert.equal(trust.get(sc) ?? 0, 0, "scam node earns no trust");
  assert.equal(graphTier(trust.get(sc) ?? 0, distrust.get(sc)!), "distrusted", "held-out scam node tier is distrusted");
  // and a core trusted node classifies as trusted (end-to-end tier check).
  assert.equal(graphTier(trust.get("T5")!, distrust.get("T5") ?? 0), "trusted", "T5 tier is trusted");
});

test("entityFinalizeStatements target compact signals and carry no bind placeholders", () => {
  // parity guard: the write-back SQL must be self-contained (literals only), like the rest of the signal SQL.
  const sql = entityFinalizeStatements(GENERATION).join("\n");
  assert(!sql.includes("?"), "finalize SQL must contain no '?' placeholders");
  assert(sql.includes("address_signals") && sql.includes("asset_signals"), "writes both signals tables");
});

test("normalized entity graph preserves Min-k sybil resistance within one generation", () => {
  const generation = 7;
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE graph_edges(generation INTEGER,source_entity_id INTEGER,destination_entity_id INTEGER,
      weight REAL,edge_block INTEGER,PRIMARY KEY(generation,source_entity_id,destination_entity_id)) WITHOUT ROWID;
    CREATE TABLE graph_node(generation INTEGER,entity_id INTEGER,outsum REAL DEFAULT 0,insum REAL DEFAULT 0,
      PRIMARY KEY(generation,entity_id)) WITHOUT ROWID;
    CREATE TABLE graph_rank(generation INTEGER,entity_id INTEGER,slot INTEGER,score REAL DEFAULT 0,
      rank REAL DEFAULT 0,normalized_rank REAL DEFAULT 0,PRIMARY KEY(generation,entity_id,slot)) WITHOUT ROWID;
    CREATE TABLE graph_seed(generation INTEGER,entity_id INTEGER,slot INTEGER,score REAL,
      PRIMARY KEY(generation,entity_id,slot)) WITHOUT ROWID;
    CREATE TABLE graph_inflow(generation INTEGER,entity_id INTEGER,value REAL,
      PRIMARY KEY(generation,entity_id)) WITHOUT ROWID;
  `);
  const names = [nameForSubset(0), nameForSubset(1), nameForSubset(2), "T1", "T2", "A0", "P1"];
  const id = new Map(names.map((name, index) => [name, index + 1]));
  const edge = db.prepare(
    `INSERT INTO graph_edges(generation,source_entity_id,destination_entity_id,weight) VALUES(?,?,?,1)`,
  );
  const put = (source: string, destination: string) => edge.run(generation, id.get(source), id.get(destination));
  for (const seed of names.slice(0, 3)) put(seed, "T1");
  put("T1", "T2");
  put("T2", "T1");
  put(names[0], "A0");
  put("P1", "A0");
  for (const sql of entityNodeStatements(generation)) db.exec(sql);
  for (const sql of entityRankInitStatements(generation)) db.exec(sql);
  const insertSeed = db.prepare(`INSERT INTO graph_seed(generation,entity_id,slot,score) VALUES(?,?,?,?)`);
  for (const seed of names.slice(0, 3)) insertSeed.run(generation, id.get(seed), seedSubset(seed), 1);
  db.exec(entitySeedApplyStatement(generation));
  for (let pass = 0; pass < PASSES; pass++)
    for (let slot = 0; slot < K; slot++) for (const sql of entityPassStatements(generation, slot, false)) db.exec(sql);
  const trust = (name: string) =>
    Number(
      db
        .prepare(`SELECT MIN(rank) value FROM graph_rank WHERE generation=? AND entity_id=? AND slot<?`)
        .get(generation, id.get(name), K)?.value ?? 0,
    );
  assert.ok(trust("T2") > 0, "held-out connected node is reached from every seed subset");
  assert.equal(trust("A0"), 0, "single-subset attacker still receives zero Min-k trust");
  assert.equal(trust("P1"), 0, "unseeded petal receives zero trust");
  db.close();
});

test("normalized edge builder resolves compact relationships through canonical entities", () => {
  const generation = 3;
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE address_dictionary(address_id INTEGER PRIMARY KEY,address TEXT UNIQUE);
    CREATE TABLE asset_dictionary(asset_id INTEGER PRIMARY KEY,asset TEXT UNIQUE);
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT,
      UNIQUE(entity_type,entity_key));
    CREATE TABLE address_signals(address_id INTEGER PRIMARY KEY,is_exchange INTEGER DEFAULT 0,
      is_burn INTEGER DEFAULT 0,is_deposit INTEGER DEFAULT 0,is_emblem_vault INTEGER DEFAULT 0,
      likely_service INTEGER DEFAULT 0);
    CREATE TABLE curated(kind TEXT,key TEXT,PRIMARY KEY(kind,key));
    CREATE TABLE sends(source_id INTEGER,destination_id INTEGER,block_index INTEGER);
    CREATE TABLE order_matches(tx0_address_id INTEGER,tx1_address_id INTEGER,block_index INTEGER);
    CREATE TABLE dispensers(tx_index INTEGER PRIMARY KEY,source_id INTEGER,origin_id INTEGER);
    CREATE TABLE dispenses(dispenser_tx_index INTEGER,source_id INTEGER,destination_id INTEGER,block_index INTEGER);
    CREATE TABLE assets(asset_id INTEGER PRIMARY KEY,issuer_id INTEGER);
    CREATE TABLE balances(balance_id INTEGER PRIMARY KEY,address_id INTEGER,asset_id INTEGER,quantity TEXT);
    CREATE TABLE graph_edges(generation INTEGER,source_entity_id INTEGER,destination_entity_id INTEGER,
      weight REAL,edge_block INTEGER,PRIMARY KEY(generation,source_entity_id,destination_entity_id)) WITHOUT ROWID;
    INSERT INTO address_dictionary VALUES(1,'alice'),(2,'bob'),(3,'buyer'),(4,'operator'),(5,'exchange');
    INSERT INTO asset_dictionary VALUES(10,'CARD');
    INSERT INTO address_signals(address_id,is_exchange) VALUES(5,1);
    INSERT INTO sends VALUES(1,2,100),(1,2,101),(5,2,102);
    INSERT INTO order_matches VALUES(1,3,103);
    INSERT INTO dispensers VALUES(40,4,4);
    INSERT INTO dispenses VALUES(40,4,3,104);
    INSERT INTO assets VALUES(10,1);
  `);
  for (const sql of ENTITY_IDENTITY_STATEMENTS) db.exec(sql);
  for (const sql of entityEdgeStatements(generation)) db.exec(sql);
  const edges = db
    .prepare(`SELECT source.entity_key source,destination.entity_key destination,ROUND(edge.weight,6) weight
      FROM graph_edges edge
      JOIN entity_dictionary source ON source.entity_id=edge.source_entity_id
      JOIN entity_dictionary destination ON destination.entity_id=edge.destination_entity_id
      WHERE edge.generation=? ORDER BY source.entity_key,destination.entity_key`)
    .all(generation);
  assert.deepEqual(
    edges.map((row) => ({ ...row })),
    [
      { source: "CARD", destination: "alice", weight: 0.693147 },
      { source: "alice", destination: "CARD", weight: 0.693147 },
      { source: "alice", destination: "bob", weight: 1.098612 },
      { source: "alice", destination: "buyer", weight: 0.693147 },
      { source: "buyer", destination: "alice", weight: 0.693147 },
      { source: "buyer", destination: "operator", weight: 0.693147 },
    ],
  );
  assert.equal(edges.some((row) => row.source === "exchange"), false, "excluded infrastructure cannot endorse");
  db.close();
});

test("normalized seeds resolve polymorphic identities without key collisions", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE entity_dictionary(entity_id INTEGER PRIMARY KEY,entity_type TEXT,entity_key TEXT,
      UNIQUE(entity_type,entity_key));
    CREATE TABLE graph_seed(generation INTEGER,entity_id INTEGER,slot INTEGER,score REAL,
      PRIMARY KEY(generation,entity_id,slot)) WITHOUT ROWID;
    INSERT INTO entity_dictionary VALUES(1,'address','SAME'),(2,'asset','SAME');
  `);
  db.prepare(entitySeedInsertStatement(4, 2)).run("address", "SAME", 0, 0.25, "asset", "SAME", 1, 0.5);
  assert.deepEqual(
    db.prepare(`SELECT entity_id,slot,score FROM graph_seed ORDER BY entity_id`).all().map((row) => ({ ...row })),
    [
      { entity_id: 1, slot: 0, score: 0.25 },
      { entity_id: 2, slot: 1, score: 0.5 },
    ],
  );
  db.close();
});
