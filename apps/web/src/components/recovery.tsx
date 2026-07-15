"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiUrl, type Envelope } from "@/lib/api/url";
import { Card, Stat } from "@/components/ui/card";
import { AreaChart } from "@/components/ui/charts";
import { Board } from "@/components/board";
import { Skeleton } from "@/components/ui/feedback";
import { commas } from "@/lib/format";

const WALLET_URL = "https://chromewebstore.google.com/detail/xcp-wallet/nicpjdbehgcjbjfjkobcidnfmfpijohg";

interface RecoverySummary {
  recoverable_outputs: number;
  recoverable_sats: number;
  protected_stamp_outputs: number;
  protected_stamp_sats: number;
  unprotected_outputs: number;
  unprotected_sats: number;
  recovery_addresses: number;
  updated_at: number;
}

interface RecoveryMonth {
  month: number;
  unprotected_outputs: number;
  unprotected_sats: number;
  protected_stamp_outputs: number;
  protected_stamp_sats: number;
}

interface RecoveryAddressStat {
  address: string;
  unprotected_outputs: number;
  unprotected_sats: number;
}

interface RecoveredMonth {
  month: number;
  outputs: number;
  spending_transactions: number;
  gross_sats: number;
}

interface RecoveryStats {
  summary: RecoverySummary;
  monthly: RecoveryMonth[];
  recovered_monthly: RecoveredMonth[];
  top_unprotected_addresses: RecoveryAddressStat[];
}

interface AddressRecovery {
  address: string;
  summary: { total_outputs: number; total_value_sats: number };
  protection: { protected_stamp_outputs: number; protected_stamp_value_sats: number };
  pending_attempts: number;
}

const btc = (sats?: number) => `${((sats ?? 0) / 100_000_000).toLocaleString(undefined, { maximumFractionDigits: 8 })} BTC`;

function RecoveryLookup() {
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<AddressRecovery | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = address.trim();
    if (!value) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(apiUrl(`/addresses/${encodeURIComponent(value)}/recovery`, { limit: 1 }));
      const body = (await response.json()) as AddressRecovery | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error : "Address lookup failed");
      setResult(body as AddressRecovery);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Address lookup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title="Check an address">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="recovery-address" className="sr-only">Bitcoin address</label>
        <input
          id="recovery-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="Enter a legacy Bitcoin P2PKH address"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !address.trim()}
          className="rounded-md bg-(--color-xcp) px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Checking…" : "Check address"}
        </button>
      </form>
      <p className="mt-2 text-xs text-zinc-500">Only legacy addresses beginning with 1 can own these bare-multisig outputs.</p>
      <div aria-live="polite">
        {error && <p className="mt-4 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</p>}
        {result && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat label="Recoverable" value={btc(result.summary.total_value_sats)} sub={`${commas(result.summary.total_outputs)} outputs`} />
            <Stat label="Protected Stamps" value={btc(result.protection.protected_stamp_value_sats)} sub={`${commas(result.protection.protected_stamp_outputs)} outputs, excluded by default`} />
            <Stat label="Pending recoveries" value={commas(result.pending_attempts)} sub="Reported by XCP Wallet" />
          </div>
        )}
      </div>
    </Card>
  );
}

function RecoveryChart({ rows, recovered }: { rows: RecoveryMonth[]; recovered: RecoveredMonth[] }) {
  const [metric, setMetric] = useState<"recoverable" | "recovered">("recoverable");
  const [cumulative, setCumulative] = useState(false);
  const data = useMemo(() => {
    const source = metric === "recoverable"
      ? rows.map((row) => ({ month: row.month, sats: row.unprotected_sats }))
      : recovered.map((row) => ({ month: row.month, sats: row.gross_sats }));
    return source.map((row, index) => {
      const value = row.sats / 100_000_000;
      const total = source.slice(0, index + 1).reduce((sum, item) => sum + item.sats / 100_000_000, 0);
      return { t: row.month, v: cumulative ? total : value };
    });
  }, [rows, recovered, metric, cumulative]);
  return (
    <Card title={metric === "recoverable" ? "Recoverable Bitcoin by creation month" : "Recovered Bitcoin by recovery month"}>
      <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="text-xs text-zinc-500">
          {metric === "recoverable"
            ? "Currently unspent, non-Stamp outputs grouped by when they were created."
            : "Gross value of indexed recovery outputs grouped by their confirmed spend date."}
        </p>
        <div className="flex flex-wrap items-center gap-1 sm:shrink-0">
          {(["recoverable", "recovered"] as const).map((value) => (
            <button key={value} type="button" onClick={() => setMetric(value)} aria-pressed={metric === value}
              className={`rounded border px-2 py-1 text-xs capitalize ${metric === value ? "border-zinc-600 bg-zinc-800 text-zinc-100" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}>
              {value}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCumulative((value) => !value)}
            aria-pressed={cumulative}
            className={`rounded border px-2 py-1 text-xs ${cumulative ? "border-sky-500/50 bg-sky-400/10 text-sky-300" : "border-zinc-800 text-zinc-500 hover:text-zinc-300"}`}
          >
            Cumulative
          </button>
        </div>
      </div>
      <AreaChart
        data={data}
        height={240}
        formatValue={(value) => `${value.toLocaleString(undefined, { maximumFractionDigits: 8 })} BTC`}
        formatDate={(timestamp) => new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(timestamp * 1000)}
      />
    </Card>
  );
}

export function Recovery() {
  const { data } = useSWR<Envelope<RecoveryStats>>(apiUrl("/v2/recovery/stats"));
  const stats = data?.result;
  const summary = stats?.summary;
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Recover Bitcoin</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Find BTC left in old Counterparty bare-multisig outputs and recover it with XCP Wallet. Stamp transactions are identified and excluded unless you explicitly opt in.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Recoverable Bitcoin" value={summary ? btc(summary.recoverable_sats) : undefined} />
        <Stat label="Without Stamps" value={summary ? btc(summary.unprotected_sats) : undefined} />
        <Stat label="Protected Stamps" value={summary ? btc(summary.protected_stamp_sats) : undefined} />
        <Stat label="Addresses" value={summary ? commas(summary.recovery_addresses) : undefined} />
      </div>
      <RecoveryLookup />
      {stats ? <RecoveryChart rows={stats.monthly} recovered={stats.recovered_monthly} /> : <Card title="Recoverable Bitcoin by creation month"><Skeleton rows={5} /></Card>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recover with XCP Wallet">
          <ol className="space-y-4 text-sm text-zinc-300">
            {[
              <>Install or update <a href={WALLET_URL} target="_blank" rel="noopener noreferrer">XCP Wallet ↗</a>.</>,
              <>Open the wallet containing the legacy address, then choose <strong className="text-zinc-200">Actions</strong>.</>,
              <>Choose <strong className="text-zinc-200">Recover Bitcoin</strong> and review the detected outputs.</>,
              <>Enter a destination, choose a fee rate, then review and sign each batch.</>,
              <>Use Recovery Status in the wallet to follow confirmation or replacement attempts.</>,
            ].map((step, index) => (
              <li key={index} className="flex gap-3"><span className="font-mono text-zinc-600">{index + 1}.</span><span>{step}</span></li>
            ))}
          </ol>
          <div className="mt-5 rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200/80">
            Stamps can be valuable. XCP Wallet leaves protected Stamp transactions out by default and requires a separate opt-in before spending them.
          </div>
        </Card>
        <Board
          title="Largest recoverable balances without Stamps"
          rows={stats?.top_unprotected_addresses ?? []}
          render={(row) => (
            <>
              <Link href={`/address/${row.address}`} className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-400">{row.address}</Link>
              <span className="shrink-0 font-mono text-xs text-zinc-400">{btc(row.unprotected_sats)}</span>
            </>
          )}
        />
      </div>
      <p className="text-xs leading-relaxed text-zinc-500">
        This index recognizes Counterparty&rsquo;s historical 1-of-2 and current 1-of-3 data layouts, verifies each candidate against Bitcoin chain state, and continuously reconciles new transactions. A 9% service fee applies above the small-output exemption; Bitcoin miner fees are separate.
      </p>
    </>
  );
}
