"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { TxAction } from "@xcp/shared/chain";
import type { SendRow } from "@xcp/shared/records";
import { RecordTable } from "@/features/records/components/record-table";
import { REGISTRY } from "@/features/records/registry";
import { assetChip, statusPill, dispenserPill, sweepFlagsBadge, type Col } from "@/features/records/cells";
import { btcAmt, xcpAmt } from "@/lib/tx";
import { amount, commas, fromSats, short } from "@/lib/format";

/**
 * JOB ② — THE RECEIPT. The settled kinds: something already happened and this page is the proof.
 * One document shape — past-tense headline, SETTLED stamp, line-item table where there are goods,
 * parties at the bottom — and a cross-link back to any LIVING thing the receipt touched (the
 * dispenser that's still open, the fairminter still minting), because receipts route the next
 * buyer to the storefront. v21 lab, job ②.
 */

const addr = (a?: string | null) =>
  a ? (
    <Link href={`/address/${a}`} className="font-mono">
      {short(a)}
    </Link>
  ) : (
    <>—</>
  );
const txLink = (h?: string | null) =>
  h ? (
    <Link href={`/tx/${h}`} className="font-mono">
      {short(h)}
    </Link>
  ) : (
    <>—</>
  );

export function ReceiptShell({
  headline,
  table,
  note,
  parties,
  children,
}: {
  headline: ReactNode;
  table?: { head: ReactNode; rows: ReactNode; foot?: ReactNode };
  note?: ReactNode; // the tfoot's left-side annotation (cross-link to the living thing)
  parties?: [string, ReactNode][];
  children?: ReactNode;
}) {
  return (
    <section className="card txreceipt">
      <div className="sale">
        {headline}
        <span className="stamp pill settled">settled</span>
      </div>
      {table && (
        <table>
          <thead>{table.head}</thead>
          <tbody>{table.rows}</tbody>
          {(table.foot || note) && (
            <tfoot>
              <tr>
                <td className="note" colSpan={2}>
                  {note}
                </td>
                {table.foot}
              </tr>
            </tfoot>
          )}
        </table>
      )}
      {!table && note && <div className="border-b border-zinc-900 px-4 py-2 text-xs text-zinc-500">{note}</div>}
      {children}
      {parties && parties.length > 0 && (
        <div className="parties">
          {parties.map(([k, v]) => (
            <span key={k}>
              {k} <b>{v}</b>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---- per-kind receipts ---- */

export function DispenseReceipt({ action }: { action: Extract<TxAction, { kind: "dispense" }> }) {
  const d = action.dispenses[0];
  const machine = action.dispenser;
  const rate = machine ? fromSats(machine.satoshirate, 1) : null;
  const stillOpen = machine && Number(machine.status) === 0 && Number(machine.give_remaining_normalized) > 0;
  return (
    <ReceiptShell
      headline={
        <span>
          <b>{commas(d.dispense_quantity_normalized)}</b> {assetChip(d.asset)} bought from a dispenser for{" "}
          <b>{btcAmt(d.btc_amount)}</b>
          {d.usd_value != null && <span className="dim"> (≈${commas(d.usd_value.toFixed(2))})</span>}
        </span>
      }
      table={{
        head: (
          <tr>
            <th>Item</th>
            <th className="r">Qty</th>
            <th className="r">Rate (BTC)</th>
            <th className="r">Total (BTC)</th>
            <th className="r">USD</th>
          </tr>
        ),
        rows: (
          <tr>
            <td>{assetChip(d.asset)}</td>
            <td className="r">{commas(d.dispense_quantity_normalized)}</td>
            <td className="r">{rate != null ? rate.toFixed(8).replace(/0+$/, "") : "—"}</td>
            <td className="r">{fromSats(d.btc_amount, 1)?.toFixed(8) ?? "—"}</td>
            <td className="r dim">{d.usd_value != null ? `$${commas(d.usd_value.toFixed(2))}` : "—"}</td>
          </tr>
        ),
        foot: (
          <>
            <td />
            <td className="r">{btcAmt(d.btc_amount)}</td>
            <td className="r">{d.usd_value != null ? `$${commas(d.usd_value.toFixed(2))}` : "—"}</td>
          </>
        ),
      }}
      note={
        machine ? (
          <span>
            machine {txLink(d.dispenser_tx_hash)} {dispenserPill(machine.status, machine.give_remaining_normalized)}
            {stillOpen && (
              <>
                {" "}
                · {commas(machine.give_remaining_normalized)} left →{" "}
                <Link href={`/tx/${d.dispenser_tx_hash}`} className="!text-(--color-accent)">
                  visit dispenser
                </Link>
              </>
            )}
          </span>
        ) : (
          <span>machine {txLink(d.dispenser_tx_hash)}</span>
        )
      }
      parties={[
        ["BUYER", addr(d.destination)],
        ["SOLD BY", addr(d.source)],
      ]}
    />
  );
}

const SEND_VERB: Record<string, string> = {
  send: "sent",
  attach: "attached to a UTXO",
  detach: "detached from a UTXO",
  move: "moved between UTXOs",
  mpma: "sent",
};

export function SendReceipt({ sends }: { sends: SendRow[] }) {
  const first = sends[0];
  if (sends.length === 1) {
    return (
      <ReceiptShell
        headline={
          <span>
            <b>{commas(first.quantity_normalized)}</b> {assetChip(first.asset)}{" "}
            {SEND_VERB[first.send_type ?? "send"] ?? "sent"}
            {first.memo && <span className="dim"> · memo “{first.memo}”</span>}
            {first.status && first.status !== "valid" && <> {statusPill(first.status)}</>}
          </span>
        }
        parties={[
          ["FROM", addr(first.source)],
          ["TO", addr(first.destination)],
        ]}
      />
    );
  }
  // MPMA — the recipients table (same columns as /sends) is the receipt's line items.
  const cols = REGISTRY.sends!.cols.filter(
    (c: Col<SendRow>) => !["Time", "Block", "View", "Type", "Source"].includes(c.label),
  );
  if (sends.some((s) => s.memo))
    cols.push({
      label: "Memo",
      w: "minmax(90px,.8fr)",
      priority: 3,
      cell: (r) =>
        r.memo ? (
          <span className="desc" title={r.memo}>
            {r.memo}
          </span>
        ) : (
          "—"
        ),
    });
  return (
    <ReceiptShell
      headline={
        <span>
          Sent to <b>{sends.length}</b> recipients in one MPMA transaction
        </span>
      }
      parties={[["FROM", addr(first.source)]]}
    >
      <div style={{ padding: "12px 16px" }}>
        <RecordTable cols={cols} rows={sends} label="MPMA recipients" />
      </div>
    </ReceiptShell>
  );
}

export function FairmintReceipt({ action }: { action: Extract<TxAction, { kind: "fairmint" }> }) {
  const m = action.fairmint;
  const minter = action.fairminter;
  const minterOpen = (minter?.status ?? "").startsWith("open");
  return (
    <ReceiptShell
      headline={
        <span>
          <b>{amount(fromSats(m.earn_quantity, m.divisible), m.divisible)}</b> {assetChip(m.asset)} minted
          {Number(m.paid_quantity) > 0 && (
            <>
              {" "}
              for <b>{xcpAmt(m.paid_quantity)}</b>
            </>
          )}
        </span>
      }
      note={
        minterOpen ? (
          <span>
            the fairminter is still open →{" "}
            <Link href={`/tx/${m.fairminter_tx_hash}`} className="!text-(--color-accent)">
              mint yours
            </Link>
          </span>
        ) : (
          <span>
            fairminter {txLink(m.fairminter_tx_hash)}
            {minter?.status && <> · {minter.status}</>}
          </span>
        )
      }
      table={{
        head: (
          <tr>
            <th>Minted</th>
            <th className="r">Units</th>
            <th className="r">Paid (XCP)</th>
          </tr>
        ),
        rows: (
          <tr>
            <td>{assetChip(m.asset)}</td>
            <td className="r">{amount(fromSats(m.earn_quantity, m.divisible), m.divisible)}</td>
            <td className="r">{Number(m.paid_quantity) > 0 ? xcpAmt(m.paid_quantity) : "free"}</td>
          </tr>
        ),
      }}
      parties={[["MINTER", addr(m.source)]]}
    />
  );
}

export function GenericReceipt({ action }: { action: TxAction }) {
  switch (action.kind) {
    case "btcpay": {
      const b = action.btcpay;
      return (
        <ReceiptShell
          headline={
            <span>
              <b>{commas(b.btc_amount_normalized)} BTC</b> paid to settle a matched DEX order
            </span>
          }
          note={
            <span className="mono" style={{ fontSize: 11 }}>
              match {b.order_match_id ? `${b.order_match_id.slice(0, 12)}…` : "—"}
            </span>
          }
          parties={[
            ["PAYER", addr(b.source)],
            ["PAID TO", addr(b.destination)],
          ]}
        />
      );
    }
    case "dividend": {
      const d = action.dividend;
      return (
        <ReceiptShell
          headline={
            <span>
              <b>{commas(d.quantity_per_unit_normalized)}</b> {assetChip(d.dividend_asset)} paid per unit to every
              holder of {assetChip(d.asset)}
            </span>
          }
          parties={[["PAID BY", addr(d.source)]]}
        />
      );
    }
    case "sweep": {
      const s = action.sweep;
      const partial = sweepFlagsBadge(s.flags);
      return (
        <ReceiptShell
          headline={
            <span>
              Everything swept{partial && <> {partial}</>} — anti-spam fee <b>{xcpAmt(s.fee_paid)}</b>
              {s.memo && <span className="dim"> · memo “{s.memo}”</span>}
            </span>
          }
          parties={[
            ["FROM", addr(s.source)],
            ["TO", addr(s.destination)],
          ]}
        />
      );
    }
    case "burn": {
      const b = action.burn;
      return (
        <ReceiptShell
          headline={
            <span>
              <b>{commas(b.burned_normalized)} BTC</b> provably burned → <b>{commas(b.earned_normalized)} XCP</b> earned
            </span>
          }
          note={<span>XCP was created only by destroying BTC in the January 2014 burn</span>}
          table={{
            head: (
              <tr>
                <th>Burned</th>
                <th className="r">BTC</th>
                <th className="r">XCP earned</th>
              </tr>
            ),
            rows: (
              <tr>
                <td className="dim">proof-of-burn</td>
                <td className="r">{commas(b.burned_normalized)}</td>
                <td className="r">{commas(b.earned_normalized)}</td>
              </tr>
            ),
          }}
          parties={[["BURNER", addr(b.source)]]}
        />
      );
    }
    case "destruction": {
      const d = action.destruction;
      return (
        <ReceiptShell
          headline={
            <span>
              <b>{commas(d.quantity_normalized)}</b> {assetChip(d.asset)} provably destroyed, forever
              {d.tag && <span className="dim"> · “{d.tag}”</span>}
            </span>
          }
          parties={[["DESTROYED BY", addr(d.source)]]}
        />
      );
    }
    case "cancel": {
      const c = action.cancel;
      const o = action.order;
      return (
        <ReceiptShell
          headline={
            <span>
              Open order {txLink(c.offer_hash)} cancelled
              {o && (
                <span className="dim">
                  {" "}
                  — it offered {commas(o.give_quantity_normalized)} {o.give_asset} for{" "}
                  {commas(o.get_quantity_normalized)} {o.get_asset}
                </span>
              )}
            </span>
          }
          parties={[["CANCELLED BY", addr(c.source)]]}
        />
      );
    }
    case "pool_liquidity": {
      const l = action.liquidity;
      const dep = l.kind === "deposit";
      return (
        <ReceiptShell
          headline={
            <span>
              Liquidity {dep ? "added to" : "withdrawn from"} the{" "}
              <b>
                {l.asset_a}/{l.asset_b}
              </b>{" "}
              pool
            </span>
          }
          table={{
            head: (
              <tr>
                <th>Leg</th>
                <th className="r">Amount</th>
              </tr>
            ),
            rows: (
              <>
                {l.quantity_a != null && (
                  <tr>
                    <td>{assetChip(l.asset_a)}</td>
                    <td className="r">{commas(l.quantity_a)}</td>
                  </tr>
                )}
                {l.quantity_b != null && (
                  <tr>
                    <td>{assetChip(l.asset_b)}</td>
                    <td className="r">{commas(l.quantity_b)}</td>
                  </tr>
                )}
                {dep && l.quantity_minted != null && (
                  <tr>
                    <td className="dim">LP tokens minted</td>
                    <td className="r">{commas(l.quantity_minted)}</td>
                  </tr>
                )}
                {!dep && l.quantity_destroyed != null && (
                  <tr>
                    <td className="dim">LP tokens burned</td>
                    <td className="r">{commas(l.quantity_destroyed)}</td>
                  </tr>
                )}
              </>
            ),
          }}
          parties={[[dep ? "DEPOSITOR" : "WITHDRAWER", addr(l.source)]]}
        />
      );
    }
    case "pool_swap": {
      const s = action.swap;
      return (
        <ReceiptShell
          headline={
            <span>
              <b>{commas(s.forward_quantity)}</b> {assetChip(s.forward_asset)} swapped for{" "}
              <b>{commas(s.backward_quantity)}</b> {assetChip(s.backward_asset)} via the{" "}
              <b className="font-mono">{s.pair}</b> pool
            </span>
          }
          note={
            s.fee_quantity != null || s.fee_bps != null ? (
              <span>
                pool fee {s.fee_quantity != null ? commas(s.fee_quantity) : "—"}
                {s.fee_bps != null && <> · {s.fee_bps / 100}%</>}
              </span>
            ) : undefined
          }
          parties={[["SWAPPER", addr(s.source)]]}
        />
      );
    }
    default:
      return null;
  }
}
