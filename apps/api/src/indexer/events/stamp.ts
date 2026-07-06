/**
 * Bitcoin Stamps classification — from a Counterparty issuance `description`.
 *
 * Ground truth: stampchain-io/btc_stamps (lib/index_core/models.py + base64_utils.py). A stamp's payload
 * follows a `stamp:` prefix in the issuance description: optional `mimetype;` then base64. Decode it —
 * if it's JSON with a "p" field in {SRC-20, SRC-721, SRC-101} it's that sub-protocol; otherwise it's a
 * classic image → STAMP. (btc_stamps additionally gates validity on `keyburn`, a raw-BTC-tx property we
 * can't see from Counterparty — so this is a TYPE tag, the strongest signal available from the Counterparty side.)
 */

const SRC_PROTOCOLS = new Set(["SRC-20", "SRC-721", "SRC-101"]);

export interface StampInfo {
  protocol: string;        // STAMP | SRC-20 | SRC-721 | SRC-101
  tick: string | null;     // SRC token ticker
  op: string | null;       // SRC op: deploy | mint | transfer
}

// base64 -> UTF-8 string (Workers have atob). Returns null on invalid base64 / non-UTF-8.
function b64utf8(b64: string): string | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

/**
 * Classify an issuance description. Returns null if it isn't a stamp. A stamp description STARTS (after
 * trim) with `stamp:` (case-insensitive) — real stamps are minted that way; requiring the prefix at the
 * start avoids false positives from descriptions that merely mention "stamp:".
 */
export function classifyStamp(description: string | null | undefined): StampInfo | null {
  if (!description) return null;
  const trimmed = description.replace(/^[\s"\\]+/, ""); // drop leading whitespace / quotes / escapes
  if (!/^stamp:/i.test(trimmed)) return null;

  let payload = trimmed.slice(6).trim();
  // A data-URI / mimetype prefix (`image/png;base64,....` or `data:image/png;base64,....`) marks a classic
  // image. If there's a ';', the base64 is after it; strip a leading `base64,` marker too.
  if (payload.includes(";")) payload = payload.slice(payload.indexOf(";") + 1);
  payload = payload.replace(/^base64,/i, "").replace(/[\s"\\]/g, "");
  if (!payload) return null;

  // Fast path: base64 of a JSON object ('{'/'{"') always starts with "ew"/"ey"; image stamps (PNG "iVBOR",
  // GIF "R0lGOD", JPEG "/9j/", BMP "Qk", SVG/XML "PD"/"PH"...) never do. Skip the expensive decode for the
  // ~100k image stamps and only decode when the payload could actually be SRC JSON.
  if (!/^ey|^ew/.test(payload)) return { protocol: "STAMP", tick: null, op: null };

  // SRC payloads are small base64 JSON; 8KB of base64 is far more than any SRC blob and avoids decoding
  // a multi-KB image in full just to fail the JSON parse.
  const decoded = b64utf8(payload.slice(0, 8192));
  if (decoded) {
    const t = decoded.trimStart();
    if (t.startsWith("{")) {
      try {
        const j = JSON.parse(decoded) as { p?: unknown; tick?: unknown; op?: unknown };
        const p = j && j.p != null ? String(j.p).toUpperCase() : null;
        if (p && SRC_PROTOCOLS.has(p)) {
          // tick is case-insensitive in SRC-20 (KEVIN == Kevin == kevin) — normalize to lowercase.
          return { protocol: p, tick: j.tick != null ? String(j.tick).toLowerCase() : null, op: j.op != null ? String(j.op).toLowerCase() : null };
        }
      } catch { /* malformed JSON — fall through to classic */ }
    }
  }
  // valid `stamp:` prefix but not a recognized SRC JSON => classic image stamp
  return { protocol: "STAMP", tick: null, op: null };
}
