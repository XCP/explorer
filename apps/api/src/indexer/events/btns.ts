/**
 * BTNS (Broadcast Token Naming System) detection — from a Counterparty BROADCAST `text`.
 *
 * Ground truth: jdogresorg/Broadcast-Token-Naming-System (docs/BTNS.md). BTNS encodes token ops in the
 * broadcast text, which begins (case-insensitive) with `btns:` or `bt:`, then pipe-delimited fields:
 * `bt:DEPLOY|TICK|...`, `bt:MINT|TICK|...`, `bt:TRANSFER|TICK|...`. (Version rides in the broadcast `value`.)
 * We only TAG — identify that a broadcast is BTNS and capture its op/tick — we do NOT implement BTNS.
 */
export interface BtnsInfo {
  op: string | null; // DEPLOY | MINT | TRANSFER | LIST | ... (uppercased)
  tick: string | null; // token ticker (field after op for DEPLOY/MINT/TRANSFER)
}
export function classifyBtns(text: string | null | undefined): BtnsInfo | null {
  if (!text) return null;
  const t = text.replace(/^\s+/, "");
  const m = /^(btns:|bt:)/i.exec(t);
  if (!m) return null;
  const parts = t.slice(m[0].length).split("|");
  const op = parts[0] ? parts[0].trim().toUpperCase() : null;
  if (!op) return null; // "bt:" with no action is not a BTNS command
  const tick = parts[1] != null && parts[1].trim() !== "" ? parts[1].trim() : null;
  return { op, tick };
}
