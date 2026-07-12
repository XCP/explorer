"use client";
import Link from "next/link";
import type { TxAction } from "@xcp/shared/chain";
import { AssetArt } from "@/features/assets/components/asset-art";
import { lockStateCell, betTypeBadge, statusPill } from "@/lib/cells";
import { xcpAmt } from "@/lib/tx";
import { commas, short } from "@/lib/format";

/**
 * JOB ③ — THE DECLARATION. Someone published or created something; the page's job is to DISPLAY it.
 * A broadcast frames its words (or its oracle value) as the content; an issuance is a birth
 * certificate that hands off to the asset's living page (unlike a dispenser, an asset HAS one);
 * bets/RPS are declared positions. v21 lab, job ③.
 */

const addr = (a?: string | null) => (a ? <Link href={`/address/${a}`} className="font-mono">{short(a)}</Link> : <>—</>);

export function BroadcastDecl({ action }: { action: Extract<TxAction, { kind: "broadcast" }> }) {
  const b = action.broadcast;
  const oracle = b.value != null && Number(b.value) !== -1;
  return (
    <section className="card txdecl">
      {b.text ? <blockquote>“{b.text}”</blockquote> : !oracle ? <blockquote className="dim">(empty broadcast)</blockquote> : null}
      {oracle && <div className="oracle" style={{ marginTop: b.text ? 12 : 0 }}>{commas(b.value)}</div>}
      <div className="meta">
        — {addr(b.source)}{b.timestamp != null && <> · feed timestamp {commas(b.timestamp)}</>}{oracle && <> · oracle value</>}{!oracle && <> · no value attached</>}{b.mime_type && <> · {b.mime_type}</>}{b.locked ? <> · feed LOCKED — it can never broadcast again</> : null}
      </div>
    </section>
  );
}

export function IssuanceBirth({ action }: { action: Extract<TxAction, { kind: "issuance" }> }) {
  const i = action.issuance;
  const name = i.asset_longname || i.asset;
  const events = (i.asset_events ?? "").split(/[\s,]+/).filter(Boolean);
  const isLock = events.includes("lock_quantity") || events.includes("lock");
  const isTransfer = !!i.transfer;
  const qty = Number(i.quantity_normalized) || 0;
  const sentence = isTransfer
    ? <>Ownership of <b>{name}</b> was transferred to <b>{addr(i.issuer)}</b>.</>
    : isLock
      ? <>The supply of <b>{name}</b> was <b>locked forever</b> — no more can ever be issued.</>
      : qty > 0
        ? <><b>{name}</b> {events.includes("creation") ? "was born" : "grew"} — <b>{commas(i.quantity_normalized)}</b> {i.divisible ? "divisible units" : Number(i.quantity_normalized) === 1 ? "indivisible unit" : "indivisible units"}, issued by <b>{addr(i.source)}</b>.</>
        : <><b>{name}</b> was updated by <b>{addr(i.source)}</b>{i.description ? <> — “{i.description}”</> : null}.</>;
  return (
    <section className="card">
      <div className="txbirth">
        {i.asset && <div className="art"><AssetArt asset={i.asset} className="w-full aspect-[5/7] rounded-lg border border-zinc-800" /></div>}
        <div>
          <div className="what">{sentence}</div>
          <div className="chips">
            {lockStateCell(i.locked)}
            {events.length > 0 && <span className="pill cancelled">{events.join(" · ").replace(/_/g, " ")}</span>}
            {i.status && i.status !== "valid" && statusPill(i.status)}
          </div>
          {i.description && <div className="go dim" style={{ wordBreak: "break-all" }}>“{i.description}”</div>}
          {i.issuer && i.issuer !== i.source && !isTransfer && <div className="go dim">issuer {addr(i.issuer)}</div>}
          <div className="go">This page is the birth record — the living page is <Link href={`/asset/${i.asset}`} className="!text-(--color-accent)">the {name} asset page</Link>, with market, holders, and provenance.</div>
        </div>
      </div>
    </section>
  );
}

export function BetDecl({ action }: { action: Extract<TxAction, { kind: "bet" }> }) {
  const b = action.bet;
  return (
    <section className="card txdecl">
      <blockquote>
        Wagered <b className="font-mono">{xcpAmt(b.wager_quantity)}</b> that the feed resolves {betTypeBadge(b.bet_type)}
        {b.target_value != null && <> at <b className="font-mono">{commas(b.target_value)}</b></>} — against a counterwager of <b className="font-mono">{xcpAmt(b.counterwager_quantity)}</b>.
      </blockquote>
      <div className="meta">— {addr(b.source)} · feed {addr(b.feed_address)} · deadline {commas(b.deadline)}{b.leverage != null && <> · leverage {commas(b.leverage)} <span title="5040 = 1x">/5040</span></>}{b.status && <> · {b.status}</>}</div>
    </section>
  );
}

export function RpsDecl({ action }: { action: Extract<TxAction, { kind: "rps" }> }) {
  const r = action.rps;
  return (
    <section className="card txdecl">
      <blockquote>Opened a rock-paper-scissors game — <b className="font-mono">{xcpAmt(r.wager)}</b> on the line, {commas(r.possible_moves)} possible moves.</blockquote>
      <div className="meta">— {addr(r.source)}{r.status && <> · {r.status}</>}</div>
    </section>
  );
}
