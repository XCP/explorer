import type { Metadata } from "next";
import type { AddressCensus, AddressKindRow } from "@xcp/shared/addresses";
import { getJson, type Envelope } from "@/lib/api/server";
import { Stat } from "@/components/ui/card";
import { commas } from "@/lib/format";

export const metadata: Metadata = {
  title: "Addresses",
  description:
    "Everything the explorer knows about the Counterparty address population: Bitcoin address families, personas, identified infrastructure, the Ethereum shadow of the vault market, and arrival waves across twelve years.",
};

// What each Bitcoin address family IS and when it entered Counterparty history. The census supplies
// the numbers; these lines supply the meaning — the page's job is knowledge, not a table.
const KIND_STORY: Record<AddressKindRow["kind"], { name: string; prefix: string; color: string; story: string }> = {
  p2pkh: {
    name: "Legacy",
    prefix: "1…",
    color: "bg-sky-400",
    story:
      "Pay-to-pubkey-hash — the original Bitcoin address, and the home of nearly all Counterparty history. The 2014 burn, the Rare Pepe era, and the Emblem vault fleet all live here.",
  },
  p2wpkh: {
    name: "SegWit",
    prefix: "bc1q…",
    color: "bg-emerald-400",
    story:
      "Native segwit keyhash — cheaper transactions, arriving in Counterparty use from 2018. The default for modern wallets, and where most new participants appear today.",
  },
  p2sh: {
    name: "Script-hash",
    prefix: "3…",
    color: "bg-amber-400",
    story:
      "Pay-to-script-hash — multisig wallets and wrapped-segwit-era addresses. A steady minority across every era.",
  },
  p2wsh: {
    name: "SegWit script",
    prefix: "bc1q… (long)",
    color: "bg-violet-400",
    story: "Native segwit scripthash — rare in Counterparty; mostly multisig infrastructure.",
  },
  taproot: {
    name: "Taproot",
    prefix: "bc1p…",
    color: "bg-fuchsia-400",
    story:
      "The newest family and the smallest — but disproportionately important: taproot's witness envelopes are how Counters and modern large-media stamps inscribe, so these few addresses mint outsized history.",
  },
};

const PERSONA_STORY: { key: string; label: string; color: string }[] = [
  { key: "creator", label: "Creators", color: "bg-fuchsia-400" },
  { key: "collector", label: "Collectors", color: "bg-sky-400" },
  { key: "trader", label: "Traders", color: "bg-emerald-400" },
  { key: "merchant", label: "Merchants", color: "bg-amber-400" },
  { key: "light", label: "Light holders", color: "bg-zinc-600" },
  { key: "dormant", label: "Dormant", color: "bg-zinc-800" },
  { key: "service", label: "Infrastructure", color: "bg-violet-900" },
  { key: "unrated", label: "Unrated", color: "bg-zinc-700" },
  { key: "integrity", label: "Flagged", color: "bg-red-900" },
];

export default async function AddressesPage() {
  const census = (await getJson<Envelope<AddressCensus>>(`/v2/addresses/census`, { revalidate: 3600 })).result;
  if (!census) throw new Error("census unavailable");

  const bitcoinTotal = census.kinds.reduce((sum, kind) => sum + kind.total, 0);
  const activeTotal = census.kinds.reduce((sum, kind) => sum + kind.active, 0);
  const rankedTotal = census.kinds.reduce((sum, kind) => sum + kind.ranked, 0);
  const personaCount = (key: string) => census.personas.find((row) => row.persona === key)?.addresses ?? 0;
  const personaTotal = census.personas.reduce((sum, row) => sum + row.addresses, 0);
  const players = ["creator", "collector", "trader", "merchant"].reduce((sum, key) => sum + personaCount(key), 0);
  const peakArrivals = Math.max(...census.arrivals.map((row) => row.addresses));

  return (
    <>
      <div className="pagehead">
        <h1>Addresses</h1>
        <p>
          Everything the explorer knows about the population behind the assets: <b>{commas(bitcoinTotal)}</b> Bitcoin
          addresses have touched Counterparty across twelve years, joined by an Ethereum shadow market and a new class
          of holdings that skip addresses entirely. Who they are matters more than how many — the interpretive layer
          starts here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Bitcoin addresses" value={commas(bitcoinTotal)} />
        <Stat label="Active on-chain" value={commas(activeTotal)} />
        <Stat label="Reputation-ranked" value={commas(rankedTotal)} />
        <Stat label="Players" value={commas(players)} />
        <Stat label="Ethereum addresses" value={commas(census.ethereum)} />
        <Stat label="UTXO-bound holdings" value={commas(census.utxo_holdings)} />
      </div>

      <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
        <div className="text-sm font-medium text-zinc-200">Bitcoin address families</div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-zinc-900" aria-label="Address family mix">
          {census.kinds.map((kind) => (
            <div
              key={kind.kind}
              className={KIND_STORY[kind.kind].color}
              style={{ width: `${(100 * kind.total) / bitcoinTotal}%` }}
            />
          ))}
        </div>
        <div className="mt-4 space-y-3">
          {census.kinds.map((kind) => {
            const story = KIND_STORY[kind.kind];
            return (
              <div key={kind.kind} className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${story.color}`} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="font-medium text-zinc-200">{story.name}</span>
                    <span className="font-mono text-xs text-zinc-500">{story.prefix}</span>
                    <span className="font-mono text-xs text-zinc-400">
                      {commas(kind.total)} · {commas(kind.ranked)} ranked
                      {kind.first_seen_block != null ? ` · since block ${commas(kind.first_seen_block)}` : ""}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-zinc-500">{story.story}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium text-zinc-200">Who they are</div>
          <div className="font-mono text-xs text-zinc-500">
            {commas(players)} players · {commas(personaTotal)} active
          </div>
        </div>
        <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-zinc-900" aria-label="Persona mix">
          {PERSONA_STORY.map(({ key, color }) =>
            personaCount(key) > 0 ? (
              <div key={key} className={color} style={{ width: `${(100 * personaCount(key)) / personaTotal}%` }} />
            ) : null,
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-zinc-500">
          {PERSONA_STORY.map(({ key, label, color }) =>
            personaCount(key) > 0 ? (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${color}`} />
                {label} {commas(personaCount(key))}
              </span>
            ) : null,
          )}
        </div>
        <p className="mt-4 max-w-[80ch] text-xs leading-5 text-zinc-500">
          Every active address classified by its dominant on-chain role — the same persona shown on each address&apos;s
          reputation header. The site&apos;s thesis in one band: a few tens of thousands of players — creators,
          collectors, traders, merchants — carry the culture, atop a long tail that holds lightly or went quiet.
          Infrastructure is counted, never ranked.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
        <div className="text-sm font-medium text-zinc-200">Identified infrastructure</div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Emblem vaults" value={commas(census.infrastructure.vaults)} />
          <Stat label="Deposit addresses" value={commas(census.infrastructure.deposits)} />
          <Stat label="Exchanges" value={commas(census.infrastructure.exchanges)} />
          <Stat label="Burn addresses" value={commas(census.infrastructure.burns)} />
        </div>
        <p className="mt-4 max-w-[80ch] text-xs leading-5 text-zinc-500">
          Addresses that are structures, not people. Emblem vaults are Bitcoin addresses whose keys live inside Ethereum
          NFTs — the largest identified class. Deposit addresses funnel into exchanges; burns provably destroy. All of
          them are excluded from reputation and personas so human measures stay human.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
          <div className="text-sm font-medium text-zinc-200">The Ethereum shadow</div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            <span className="font-mono text-zinc-300">{commas(census.ethereum)}</span> Ethereum addresses appear in the
            mirror without ever touching Bitcoin: buyers, sellers, and currencies of the Emblem vault market, where
            wrapped Counterparty assets trade on OpenSea. They hold no Counterparty balances — they are the demand side
            of a market whose supply lives on Bitcoin.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
          <div className="text-sm font-medium text-zinc-200">Holdings without addresses</div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            <span className="font-mono text-zinc-300">{commas(census.utxo_holdings)}</span> outputs hold assets bound
            directly to a Bitcoin UTXO rather than an address — a newer protocol feature where the coin itself is the
            owner. Spend the output, move the asset. They are tracked as holdings, not people, and sit outside every
            population count above.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border2)] bg-[var(--surface)] p-5">
        <div className="text-sm font-medium text-zinc-200">Arrival waves</div>
        <div className="mt-3 space-y-1">
          {census.arrivals.map((row) => (
            <div key={row.year} className="flex items-center gap-3">
              <span className="w-10 shrink-0 font-mono text-xs text-zinc-500">{row.year}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-900">
                <div
                  className="h-full rounded-full bg-sky-500"
                  style={{ width: `${(100 * row.addresses) / peakArrivals}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-400">
                {commas(row.addresses)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-[80ch] text-xs leading-5 text-zinc-500">
          First on-chain appearance by year — the protocol&apos;s whole history as a population curve: the 2014 genesis,
          the 2016–17 Rare Pepe boom, the quiet years, and the 2021–23 revival that brought the largest wave of new
          addresses Counterparty has ever seen.
        </p>
      </div>
    </>
  );
}
