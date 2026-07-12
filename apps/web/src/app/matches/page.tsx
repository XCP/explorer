import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Order Matches", description: "Recent Counterparty DEX order matches." };
export default function Page() {
  return <IndexPage name="order_matches" />;
}
