import type { TxAction } from "@xcp/shared/chain";
import { DispenserStorefront, FairminterCampaign, OrderOffer } from "@/components/tx-offer";
import { DispenseReceipt, SendReceipt, FairmintReceipt, GenericReceipt } from "@/components/tx-receipt";
import { BroadcastDecl, IssuanceBirth, BetDecl, RpsDecl } from "@/components/tx-declaration";

/**
 * The tx page's second half — routed by the page's JOB, not just its kind (v21 lab):
 *   ① OFFER (the page IS the storefront; dead offers become their own epitaph + record):
 *     dispenser · refill (renders its dispenser's storefront) · fairminter · order
 *   ② RECEIPT (settled proof, cross-linking any living thing it touched):
 *     dispense · send/MPMA · fairmint · btcpay · dividend · sweep · burn · destruction · cancel ·
 *     pool deposit/withdrawal/swap
 *   ③ DECLARATION (the page displays what was published/created):
 *     broadcast · issuance · bet · rps
 * The confirmation header above and the child-record tables belong to every job; unclassifiable
 * kinds (OPEN_POOL — no tx_hash in the mirror; dispenser closes) fall back to the header alone.
 */
export function TxActionPanel({ action, tip }: { action: TxAction; tip: number | null }) {
  switch (action.kind) {
    // ── ① offers ──
    case "dispenser":
      return <DispenserStorefront dispenser={action.dispenser} sales={action.sales} totals={action.totals} collection={action.collection} supply={action.supply} />;
    case "refill":
      return action.dispenser
        ? <DispenserStorefront dispenser={action.dispenser} sales={action.sales} totals={action.totals} collection={action.collection} supply={action.supply} refillNote />
        : null;
    case "fairminter":
      return <FairminterCampaign fairminter={action.fairminter} />;
    case "order":
      return <OrderOffer order={action.order} matches={action.matches} collection={action.collection} supply={action.supply} tip={tip} />;

    // ── ② receipts ──
    case "dispense":
      return <DispenseReceipt action={action} />;
    case "send":
      return <SendReceipt sends={action.sends} />;
    case "fairmint":
      return <FairmintReceipt action={action} />;
    case "btcpay":
    case "dividend":
    case "sweep":
    case "burn":
    case "destruction":
    case "cancel":
    case "pool_liquidity":
    case "pool_swap":
      return <GenericReceipt action={action} />;

    // ── ③ declarations ──
    case "broadcast":
      return <BroadcastDecl action={action} />;
    case "issuance":
      return <IssuanceBirth action={action} />;
    case "bet":
      return <BetDecl action={action} />;
    case "rps":
      return <RpsDecl action={action} />;

    default:
      return null;
  }
}
