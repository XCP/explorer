"use client";

/**
 * The boundary above the root layout.
 *
 * `app/error.tsx` catches a throw inside a page, but not one from the layout
 * that wraps it — and not one from `error.tsx` itself. Without this file those
 * cases fall through to a raw Workers 500 with nothing rendered at all.
 *
 * It replaces the document, so it renders its own `<html>` and `<body>` and
 * imports nothing that could fail: no providers, no data, no stylesheet-
 * dependent class names. Inline styles only.
 */

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#171717", background: "#fff" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "96px 16px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 12px" }}>This page didn&rsquo;t load</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#666", margin: "0 0 20px" }}>
            Something failed while building it. Trying again usually works.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              color: "#fff",
              background: "#171717",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? <p style={{ fontSize: 12, color: "#999", marginTop: 24 }}>Reference {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
