"use client";
import { useMemo, useState } from "react";
import DOMPurify from "dompurify";

// Renders a CIP-25 Enhanced Asset Info object (already fetched + hash-checked server-side by /enhanced).
// Safety model ported from the old xcp.io: DOMPurify-sanitize any HTML, then compare original vs sanitized
// length — if <8% was stripped the content is treated as clean and shown with NO friction; only when
// sanitization actually removed something meaningful do we gate the raw version behind an explicit opt-in.
// (No hardcoded per-asset exceptions.) Media routes by field to <img>/<video>/<audio>.
type Json = Record<string, unknown>;
const isUrl = (s: unknown): s is string => typeof s === "string" && /^https?:\/\//i.test(s.trim());
const httpUrl = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);
const label = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
const minify = (s: string) => s.replace(/\s+/g, " ").trim();

// sanitize + decide whether meaningful markup was removed (the "don't cry wolf" heuristic)
function sanitize(html: string): { clean: string; stripped: boolean } {
  if (typeof window === "undefined") return { clean: html, stripped: false };
  const clean = DOMPurify.sanitize(html);
  const o = minify(html).length,
    c = minify(clean).length;
  return { clean, stripped: o > 0 && Math.abs(o - c) / o > 0.08 };
}

function DescriptionHtml({ html }: { html: string }) {
  const [raw, setRaw] = useState(false);
  const { clean, stripped } = useMemo(() => sanitize(html), [html]);
  if (raw && stripped) {
    return (
      <>
        <div className="prose-invert text-sm" dangerouslySetInnerHTML={{ __html: html }} />
        <p className="mt-1 text-xs text-amber-400">Showing unsanitized content — it may contain unsafe elements.</p>
      </>
    );
  }
  return (
    <>
      <div className="text-sm text-zinc-300 [&_a]:text-sky-400" dangerouslySetInnerHTML={{ __html: clean }} />
      {stripped && (
        <button onClick={() => setRaw(true)} className="mt-1 text-xs text-sky-400 hover:text-sky-300">
          Load unsanitized content (may contain unsafe elements)
        </button>
      )}
    </>
  );
}

// v1 (image / image_large / image_large_hd) OR v2 (images: [{type,data,size}])
function Images({ images }: { images: unknown }) {
  const items: { url: string; cap: string }[] = [];
  if (Array.isArray(images)) {
    for (const im of images as Json[])
      if (typeof im?.data === "string")
        items.push({ url: httpUrl(im.data), cap: [im.type, im.size].filter(Boolean).join(" · ") });
  } else if (images && typeof images === "object") {
    for (const k of ["image", "image_large", "image_large_hd"]) {
      const v = (images as Json)[k];
      if (typeof v === "string") items.push({ url: httpUrl(v), cap: label(k) });
    }
  }
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {items.map((it, i) => (
        <a key={i} href={it.url} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center">
          <img src={it.url} alt="" loading="lazy" className="h-32 w-auto rounded-md ring-1 ring-white/5" />
          {it.cap && <span className="mt-1 text-[10px] text-zinc-500">{it.cap}</span>}
        </a>
      ))}
    </div>
  );
}

function Media({ kind, value }: { kind: "video" | "audio"; value: unknown }) {
  const url =
    typeof value === "string"
      ? value
      : typeof (value as Json)?.url === "string"
        ? ((value as Json).url as string)
        : null;
  if (!url) return null;
  return kind === "video" ? (
    <video controls playsInline preload="metadata" className="max-w-full rounded-md">
      <source src={httpUrl(url)} />
    </video>
  ) : (
    <audio controls preload="metadata" className="w-full">
      <source src={httpUrl(url)} />
    </audio>
  );
}

const Val = ({ k, v }: { k: string; v: unknown }) => {
  if (v == null || v === "") return null;
  if (k === "description" && typeof v === "string" && !isUrl(v)) return <DescriptionHtml html={v} />;
  if (isUrl(v))
    return (
      <a
        href={httpUrl(v)}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-sky-400 hover:text-sky-300"
      >
        {v}
      </a>
    );
  if (typeof v === "boolean") return <>{v ? "Yes" : "No"}</>;
  if (typeof v === "object")
    return <span className="break-all font-mono text-xs text-zinc-400">{JSON.stringify(v)}</span>;
  return <span className="text-zinc-300">{String(v)}</span>;
};

// which keys we render as first-class sections vs. fold into "More"
const HANDLED = new Set([
  "success",
  "asset",
  "image",
  "image_large",
  "image_large_hd",
  "images",
  "video",
  "audio",
  "name",
  "image_title",
  "description",
  "attributes",
]);

export function AssetEnhancedInfo({
  data,
  verified,
  onClose,
}: {
  data: Json;
  verified?: boolean;
  onClose?: () => void;
}) {
  const attributes =
    Array.isArray(data.attributes) && (data.attributes as Json[]).every((a) => a?.trait_type && "value" in a)
      ? (data.attributes as Json[])
      : null;
  const rows = Object.entries(data).filter(([k, v]) => !HANDLED.has(k) && v != null && v !== "");
  return (
    <div className="mt-3 rounded-lg border border-[var(--border2)] bg-[var(--panel2)] p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">Enhanced info</span>
          {verified && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
              ✓ hash verified
            </span>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close enhanced info"
            className="cursor-pointer -m-1 rounded p-1 text-zinc-500 hover:text-zinc-200"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        )}
      </div>

      {data.images || data.image || data.image_large_hd ? <Images images={data.images ?? data} /> : null}
      {data.video ? <Media kind="video" value={data.video} /> : null}
      {data.audio ? <Media kind="audio" value={data.audio} /> : null}

      <dl className="divide-y divide-[var(--border-soft,#191e26)]">
        {typeof data.name === "string" && data.name ? (
          <Row t="Name">
            <span className="text-zinc-200">{data.name}</span>
          </Row>
        ) : null}
        {typeof data.image_title === "string" && data.image_title ? (
          <Row t="Title">
            <span className="text-zinc-200">{data.image_title}</span>
          </Row>
        ) : null}
        {data.description != null && data.description !== "" ? (
          <Row t="Description">
            <Val k="description" v={data.description} />
          </Row>
        ) : null}
        {rows.map(([k, v]) => (
          <Row key={k} t={label(k)}>
            <Val k={k} v={v} />
          </Row>
        ))}
      </dl>

      {attributes && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attributes.map((a, i) => (
            <div key={i} className="rounded-md border border-[var(--border2)] bg-[var(--panel)] p-2">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">{String(a.trait_type)}</div>
              <div className="text-sm text-zinc-200">{String(a.value)}</div>
            </div>
          ))}
        </div>
      )}

      <RawJson data={data} />
    </div>
  );
}

const Row = ({ t, children }: { t: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap gap-x-3 py-1.5 text-sm">
    <dt className="min-w-[7rem] shrink-0 text-zinc-500">{t}</dt>
    <dd className="min-w-0 flex-1">{children}</dd>
  </div>
);

function RawJson({ data }: { data: Json }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="font-mono text-[11px] text-zinc-500 hover:text-zinc-300">
        {open ? "▾ hide raw JSON" : "▸ view raw JSON"}
      </button>
      {open && (
        <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-[var(--border2)] bg-[var(--bg)] p-3 text-[11px] leading-relaxed text-zinc-400">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
