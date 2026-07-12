import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "BTCPays", description: "Recent Counterparty BTC payments." };
export default function Page() {
  return <IndexPage name="btcpays" />;
}
