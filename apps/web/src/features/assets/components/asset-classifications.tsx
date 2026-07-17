import {
  Stamp,
  Coins,
  Layers,
  Vault,
  Clock,
  Users,
  AlertTriangle,
  Landmark,
  History,
  type LucideIcon,
} from "lucide-react";

// Every way an asset is classified, surfaced as one chip strip so nothing we compute stays hidden. Three
// registers: PROTOCOL (what standard it is), descriptive BEHAVIOR, and one INTEGRITY flag. Tags do not feed
// Rating merely because they exist. Collection membership lives in the context band, the grail/locked
// badges + rating live in the header — this fills in everything else. Only tags actually present render.
type Tone = "protocol" | "quality" | "warn" | "provenance";
const CLASS: Record<string, { label: string; Icon: LucideIcon; tone: Tone; title: string }> = {
  // provenance — Counterparty predates the Ethereum NFT era; these are the historical headline tags
  "pre-ethereum": {
    label: "Pre-Ethereum",
    Icon: Landmark,
    tone: "provenance",
    title: "Issued before Ethereum's genesis block (July 30, 2015) — older than the entire Ethereum chain",
  },
  "pre-cryptopunks": {
    label: "Pre-CryptoPunks",
    Icon: History,
    tone: "provenance",
    title: "Issued before CryptoPunks V1 (June 9, 2017) — predates the first Ethereum NFTs",
  },
  // protocol — what this asset IS
  stamp: {
    label: "Stamp",
    Icon: Stamp,
    tone: "protocol",
    title: "Bitcoin Stamp — art stored permanently on-chain in the UTXO set",
  },
  src20: {
    label: "SRC-20",
    Icon: Coins,
    tone: "protocol",
    title: "SRC-20 — the Bitcoin Stamps fungible-token standard",
  },
  src721: {
    label: "SRC-721",
    Icon: Layers,
    tone: "protocol",
    title: "SRC-721 — the Bitcoin Stamps composable-NFT standard",
  },
  // behavior — descriptive observations, not implicit Rating inputs
  vaulted: {
    label: "Vaulted",
    Icon: Vault,
    tone: "quality",
    title: "Some supply is wrapped in an Emblem Vault (tradable on Ethereum)",
  },
  durable: {
    label: "Durable",
    Icon: Clock,
    tone: "quality",
    title: "Traded across a long span — it has staying power",
  },
  broad: { label: "Broad", Icon: Users, tone: "quality", title: "50+ holders — widely distributed" },
  // integrity
  low_quality: {
    label: "Low quality",
    Icon: AlertTriangle,
    tone: "warn",
    title:
      "Reviewed integrity classification — Rating is capped at Speculative and the asset is excluded from ranked recommendations",
  },
};
// stable display order regardless of the tag array's order
const ORDER = [
  "pre-ethereum",
  "pre-cryptopunks",
  "stamp",
  "src20",
  "src721",
  "vaulted",
  "durable",
  "broad",
  "low_quality",
];
const TONE_CLASS: Record<Tone, string> = {
  provenance: "bg-purple-500/10 text-purple-300 ring-purple-500/20",
  protocol: "bg-sky-500/10 text-sky-300 ring-sky-500/20",
  quality: "bg-teal-500/10 text-teal-300 ring-teal-500/20",
  warn: "bg-amber-500/10 text-amber-300 ring-amber-500/20",
};

export function AssetClassifications({ tags }: { tags?: string[] | null }) {
  const present = ORDER.filter((t) => tags?.includes(t) && CLASS[t]);
  if (present.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-0.5">Classified as</span>
      {present.map((t) => {
        const c = CLASS[t];
        return (
          <span
            key={t}
            title={c.title}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASS[c.tone]}`}
          >
            <c.Icon className="size-3" />
            {c.label}
          </span>
        );
      })}
    </div>
  );
}
