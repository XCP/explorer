"use client";
/**
 * Fathom Analytics — privacy-first, no cookies, no consent banner needed. The embed script
 * auto-tracks pageviews INCLUDING SPA history navigation, so no router wiring is required; this
 * module only exposes the typed event helper for conversions (usefathom.com/docs/events).
 *
 * Usage: `trackEvent("clicked trade on xcpdex")` or with value `trackEvent("bought", { _value: 500 })`
 * (_value is in CENTS, per Fathom's ecommerce-conversions doc). Safe to call anywhere client-side —
 * silently a no-op when the script hasn't loaded (dev, blockers, first paint).
 */

declare global {
  interface Window {
    fathom?: { trackEvent: (name: string, opts?: { _site_id?: string; _value?: number }) => void };
  }
}

export const FATHOM_SITE_ID = "FVFGOFSG";

export function trackEvent(name: string, opts?: { _value?: number }): void {
  if (typeof window === "undefined" || !window.fathom) return;
  try {
    window.fathom.trackEvent(name, opts);
  } catch {
    // analytics must never break the app
  }
}
