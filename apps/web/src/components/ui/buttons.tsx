// Buttons — xcp brand primary + zinc secondary, with extension-style focus rings.
const btnBase = "inline-flex items-center justify-center rounded font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";
export const PrimaryButton = ({ children, className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p} className={`${btnBase} px-4 py-2 bg-(--color-brand) text-white hover:brightness-110 focus-visible:ring-(--color-accent) ${className}`}>{children}</button>
);
export const SecondaryButton = ({ children, className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...p} className={`${btnBase} px-3 py-1.5 border border-zinc-700 text-zinc-200 hover:bg-zinc-900 focus-visible:ring-zinc-600 ${className}`}>{children}</button>
);
