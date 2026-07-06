"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavGroup = { heading?: string; links: [label: string, href: string][] };

/**
 * Disclosure nav dropdown (desktop). Interaction contract:
 *  - hover opens; a PADDING bridge (not margin) spans the gap to the panel, and closing is delayed
 *    150ms — the cursor can cross to the panel without it vanishing
 *  - click toggles (touch/keyboard); Escape closes and returns focus; outside pointerdown closes
 *  - stays open while focus is inside (keyboard users can Tab through the links)
 *  - trigger reflects state: aria-expanded + highlighted when a child route is active
 */
export function NavMenu({ label, id, groups }: { label: string; id: string; groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const pathname = usePathname();
  const active = groups.some((g) => g.links.some(([, href]) => pathname.startsWith(href)));

  useEffect(() => setOpen(false), [pathname]); // navigating closes the menu

  const cancelClose = () => { if (closeTimer.current != null) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setOpen(false), 150); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); rootRef.current?.querySelector("button")?.focus(); }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onPointerDown); };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
      onBlur={(e) => { if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className={`transition-colors ${active || open ? "text-[--color-accent]" : "text-zinc-400 hover:text-zinc-200"}`}
      >
        {label} <span aria-hidden="true" className="text-[9px]">▾</span>
      </button>
      {open && (
        // top-full + pt-2: the visual gap is PADDING inside the hover area — no dead zone.
        <div id={id} className="absolute left-0 top-full pt-2 z-50">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 shadow-xl flex gap-6">
            {groups.map((g, i) => (
              <div key={g.heading ?? i} className="min-w-28">
                {g.heading && (
                  <div className="pb-1 text-[10px] uppercase tracking-wider text-zinc-500">{g.heading}</div>
                )}
                <div className="flex flex-col">
                  {g.links.map(([l, href]) => (
                    <Link
                      key={href}
                      href={href}
                      className={`!no-underline text-xs py-1 whitespace-nowrap ${pathname.startsWith(href) ? "!text-zinc-100" : "!text-zinc-400 hover:!text-zinc-100"}`}
                    >
                      {l}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
