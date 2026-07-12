// Small CDN asset icon.

// Asset icon from the CDN. Plain <img> on purpose — NOT next/image: these are tiny, immutable,
// already-sized CDN icons, and the optimizer just adds a failure point (cf. the xcpdex _next/image bug).
export const AssetIcon = ({ asset, size = 20, className }: { asset: string; size?: number; className?: string }) => (
  <img src={`https://cdn.xcp.io/img/icon/${encodeURIComponent(asset)}`} alt="" width={size} height={size}
    loading="lazy" className={`rounded-sm bg-zinc-800 shrink-0${className ? ` ${className}` : ""}`} />
);
