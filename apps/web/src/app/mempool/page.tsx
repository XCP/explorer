import type { Metadata } from "next";
import { MempoolFeed } from "@/components/mempool-feed";
export const metadata: Metadata = {
  title: "Mempool",
  description: "Live pending Counterparty actions — unconfirmed sends, issuances, orders, and dispenses in the Bitcoin mempool.",
};
export default function Page() {
  return <MempoolFeed />;
}
