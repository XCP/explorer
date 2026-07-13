import type { Stmt } from "#api/indexer/events/context";

export interface IdentitySet {
  addresses: Set<string>;
  assets: Set<string>;
}

export function createIdentitySet(): IdentitySet {
  return { addresses: new Set(), assets: new Set() };
}

/** Dictionary rows must be committed before statements that resolve their integer identities. */
export function dictionaryStatements(identities: IdentitySet): Stmt[] {
  return [
    ...[...identities.addresses].map(
      (address): Stmt =>
        (db) =>
          db.prepare(`INSERT OR IGNORE INTO address_dictionary(address) VALUES (?)`).bind(address),
    ),
    ...[...identities.assets].map(
      (asset): Stmt =>
        (db) =>
          db.prepare(`INSERT OR IGNORE INTO asset_dictionary(asset) VALUES (?)`).bind(asset),
    ),
  ];
}
