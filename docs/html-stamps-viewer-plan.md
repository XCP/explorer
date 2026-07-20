# HTML stamps viewer — research + design

Why HATRSGONHATE (and ~465 other stamps) show a placeholder, and how to render them properly.
Researched 2026-07-20 from the official Bitcoin Stamps repos (stampchain-io/btc_stamps,
stampchain-io/stampchain.io, stampchain-io/src721r-example) + the local btc_stamps checkout.

## What the official code taught us

1. **HTML stamps are a first-class type.** The indexer's production corpus counts 465 `text/html`
   stamps. Detection is strict (`is_legitimate_html`): valid UTF-8, <5% binary bytes, requires
   `<html` AND `<body`, rejects image magic bytes. Adopt the same rules at ingest.
2. **Payloads are often compressed.** Stamps are frequently gzip/zlib-deflated on-chain to fit
   (the SRC-721r example stamps `nft.min.js.gz`). The indexer runs `try_decompress` before mime
   sniffing. Our ingest and serving must do the same.
3. **The recursion convention is `/s/<CPID>` — this is the key finding.** Recursive stamps
   reference other stamped files by *relative* URL: `/s/A10207619717431880000` (asset names).
   Shared on-chain libraries exist (append.js, w.js — a 3D WebGL micro-lib). Therefore an HTML
   stamp only renders on an origin that also serves `/s/<cpid>`. Hosting the HTML alone is not
   enough — without `/s/`, every recursive dependency 404s.
4. **How stampchain renders them**: `<iframe sandbox="allow-scripts allow-same-origin" loading="lazy">`
   inside a square container, placeholder image underneath, and an auto-scale trick that measures
   `contentDocument` (which is why they grant `allow-same-origin`) and CSS-scales the iframe to fit.
5. `STAMP:<assetname>` descriptions (HATRSGONHATE's form) are by-reference stamps; the payload
   lives in the asset's own issuance witness data. Our img-cdn currently misparses these as inline
   base64 (decodes the name as garbage) instead of falling through to witness reconstruction.

## Design for xcp.io

- **cdn.xcp.io gains `GET /s/<cpid>`** — the recursion endpoint that makes our CDN a valid
  recursive-stamps host: resolve the asset's stamp payload (R2 if ingested; else reconstruct from
  the issuance witness — the OLGA path img-cdn already has), `try_decompress`, sniff content-type,
  serve with a long cache and a restrictive CSP. Serving from the CDN origin (no credentials, no
  cookies) is what makes `allow-same-origin` in the sandbox acceptable.
- **img-cdn ingest**: `processStamp` stops discarding `text/html` — after decompression, bytes
  passing the `is_legitimate_html` rules save to R2 as `.html`. Fix the `STAMP:<name>` branch to
  fall through to witness reconstruction when base64 sniffing fails (fixes by-name image stamps
  too). Backfill population ≈ 465 — one scan-endpoint run.
- **Web asset page**: when the resolved media is HTML, show a "HTML stamp — ▶ Render" card
  (click-to-run, not autoplay) that mounts
  `<iframe sandbox="allow-scripts allow-same-origin" src="https://cdn.xcp.io/s/<asset>">` with
  stampchain's square-container + placeholder + auto-scale pattern, and a **"view source" tab**
  showing the pretty-printed on-chain HTML — the source *is* the artifact, and showing it is
  exactly an explorer's job.
- **Mirror metadata**: surface the stamps-aware mime (`text/html`) on the asset detail so the
  art component can branch (the issuance's own mime says `text/plain`).

## Shipped 2026-07-20 (second pass)

- Posters are AUTOMATED: `renderPoster` rasterizes `/s/{asset}` in the Browser Rendering binding
  (600px PNG → `full/`, icons derive) — runs at ingest after `saveHtml`, retro passes via
  token-gated `/admin/render-posters`, no-ops gracefully without the binding. Verified end-to-end
  in production (worker-rendered 600×600 poster served).
- `/s/` accepts stamp NUMBERS (resolved once via stampchain, KV-cached forever).

## Remaining gaps, sized (D1 counts, 2026-07-20)

| Gap | Population | Effort | Verdict |
|---|---|---|---|
| SRC-721 layer composition | **29,226 assets** | ~half day | **Worth it — biggest media-coverage win available.** Mint JSON indexes into the deploy asset's layer arrays; render = an SVG stacking `<image href="/s/{layer}">` in order, stored as `full/{asset}.svg` (icons derive; no browser needed). Verify layer-array/trait semantics against btc_stamps' src721.py first. |
| SRC-20 ticker cards | 44,325 | small (SVG template) | Taste call — stampchain renders deterministic ticker cards for these; ours are deliberately media-less today. Cheap if wanted, but it is generated decoration, not on-chain art. |
| Audio stamps | **1 asset** | trivial | Skip. One asset does not need a pipeline. |
| Stamp-number references | — | — | Done. |

Recommended order: SRC-721 composition next (turns ~29k placeholders into art and completes
"stamps support" in any meaningful sense), SRC-20 cards only if the owner wants tables to look
alive at the cost of showing generated rather than on-chain imagery.

## Caveats

- Recursive stamps fetching ordinals endpoints or exotic hosts render partially — the
  view-source tab is the graceful floor.
- `allow-same-origin` + `allow-scripts` is only safe because cdn.xcp.io is a separate,
  credential-less origin. Never mount stamp HTML on xcp.io itself.
- Work lives mostly in the img-cdn repo (ingest + `/s/` route + backfill); explorer side is one
  art-component branch + mime plumbing.
