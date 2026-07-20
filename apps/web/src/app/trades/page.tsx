import type { Metadata } from "next";
import { Trades } from "@/components/trades";
export const metadata: Metadata = {
  title: "Trades",
  description: "Unified Counterparty sales feed — DEX, dispensers, Tokenly Swapbots, auctions, and Emblem vaults.",
};
export default function Page() {
  return <Trades />;
}
