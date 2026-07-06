import type { Metadata } from "next";
import { IndexPage } from "@/components/index-page";
export const metadata: Metadata = { title: "BTCPays", description: "Recent Counterparty BTC payments." };
export default function Page() {
  return <IndexPage name="btcpays" />;
}
