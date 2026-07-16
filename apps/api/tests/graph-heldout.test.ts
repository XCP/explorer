import assert from "node:assert/strict";
import { test } from "node:test";
import { edgeWeight, evaluateHeldoutGraph, validationFold } from "#ops/lib/graph-heldout";

test("held-out fold is deterministic and temporal decay preserves current-state edges", () => {
  assert.equal(validationFold("asset:RAREPEPE:0"), validationFold("asset:RAREPEPE:0"));
  assert.equal(edgeWeight({ weight: 4, edge_block: null }, 100, 10), 4);
  assert.equal(edgeWeight({ weight: 4, edge_block: 90 }, 100, 10), 2);
});

test("held-out evaluator recovers connected labels without receiving their teleport mass", () => {
  const keys = (prefix: string, slot: number) => {
    for (let index = 0; ; index++) {
      const key = `${prefix}${index}`;
      if (validationFold(`address:${key}:${slot}`) === 0) return key;
    }
  };
  const heldTrust = keys("held-trust-", 0);
  const heldDistrust = keys("held-bad-", 3);
  const seeds = [
    { entity_id: 1, entity_type: "address", key: "train0", slot: 0 },
    { entity_id: 2, entity_type: "address", key: "train1", slot: 1 },
    { entity_id: 3, entity_type: "address", key: "train2", slot: 2 },
    { entity_id: 4, entity_type: "address", key: "bad", slot: 3 },
    { entity_id: 5, entity_type: "address", key: heldTrust, slot: 0 },
    { entity_id: 6, entity_type: "address", key: heldDistrust, slot: 3 },
  ];
  // Ensure training labels are not accidentally assigned to the held-out fold.
  for (const seed of seeds.slice(0, 4)) {
    let suffix = 0;
    while (validationFold(`${seed.entity_type}:${seed.key}:${seed.slot}`) === 0) seed.key = `train${seed.slot}-${++suffix}`;
  }
  const edges = [
    { source: 1, destination: 5, weight: 1, edge_block: 100 },
    { source: 2, destination: 5, weight: 1, edge_block: 100 },
    { source: 3, destination: 5, weight: 1, edge_block: 100 },
    { source: 6, destination: 4, weight: 1, edge_block: 100 },
  ];
  const result = evaluateHeldoutGraph({ edges, seeds, maxNode: 6, tip: 100 });
  assert.equal(result.heldout.trust, 1);
  assert.equal(result.heldout.distrust, 1);
  assert.equal(result.trust.zero_score, 0);
  assert.equal(result.distrust.zero_score, 0);
  assert.equal(result.trust.by_entity_type.address.total, 1);
});
