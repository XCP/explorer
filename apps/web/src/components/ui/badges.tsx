// Small asset/status badges — CDN asset icon + lock pill.

// Asset icon from the CDN. Plain <img> on purpose — NOT next/image: these are tiny, immutable,
// already-sized CDN icons, and the optimizer just adds a failure point (cf. the xcpdex _next/image bug).
export const AssetIcon = ({ asset, size = 20, className }: { asset: string; size?: number; className?: string }) => (
  <img src={`https://cdn.xcp.io/img/icon/${encodeURIComponent(asset)}`} alt="" width={size} height={size}
    loading="lazy" className={`rounded-sm bg-zinc-800 shrink-0${className ? ` ${className}` : ""}`} />
);

// Lock badge (Catalyst lock pill, recolored for the dark theme).
export const LockBadge = ({ locked }: { locked?: boolean | number }) => (
  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
    locked ? "bg-red-400/10 text-red-400 ring-red-400/20" : "bg-green-400/10 text-green-400 ring-green-400/20"
  }`}>{locked ? "locked" : "open"}</span>
);
