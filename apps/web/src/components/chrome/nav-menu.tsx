"use client";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavGroup = { heading?: string; links: [label: string, href: Route][] };

/**
 * Disclosure nav dropdown (desktop). Interaction contract:
 *  - hover opens; a PADDING bridge (not margin) spans the gap to the panel, and closing is delayed
 *    150ms — the cursor can cross to the panel without it vanishing
 *  - click toggles (touch/keyboard); Escape closes and returns focus; outside pointerdown closes
 *  - stays open while focus is inside (keyboard users can Tab through the links)
 *  - trigger reflects state: aria-expanded + highlighted when a child route is active
 */
export function NavMenu({ label, id, groups }: { label: string; id: string; groups: NavGroup[] }) {
  const [openForPath, setOpenForPath] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const pathname = usePathname();
  const open = openForPath === pathname;
  const setOpen = (value: boolean) => setOpenForPath(value ? pathname : null);
  const active = groups.some((g) => g.links.some(([, href]) => pathname.startsWith(href)));

  const cancelClose = () => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenForPath(null);
        rootRef.current?.querySelector("button")?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenForPath(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        className={`rounded-md px-[11px] py-1.5 transition-colors ${active || open ? "text-zinc-100 bg-zinc-900" : "text-zinc-400 hover:text-zinc-100"}`}
      >
        {label}{" "}
        <span aria-hidden="true" className="text-[9px]">
          ▾
        </span>
      </button>
      {open && (
        // top-full + pt-2: the visual gap is PADDING inside the hover area — no dead zone.
        <div id={id} className="absolute left-0 top-full pt-2 z-50">
          <div className="rounded-lg border border-[#262a33] bg-[#101216] p-2.5 shadow-[0_10px_30px_rgba(0,0,0,.5)] flex gap-6">
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
                      className={`!no-underline text-[13px] rounded-md px-2.5 py-[7px] whitespace-nowrap ${pathname.startsWith(href) ? "!text-zinc-100 bg-sky-400/10" : "!text-zinc-400 hover:!text-zinc-100 hover:bg-white/5"}`}
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
