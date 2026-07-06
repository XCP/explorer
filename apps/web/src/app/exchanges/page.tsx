import type { Metadata } from "next";
import { ExchangeDirectory } from "@/components/exchange-directory";
export const metadata: Metadata = { title: "Exchanges", description: "Known exchange wallets that listed Counterparty tokens." };
export default function Page() {
  return <ExchangeDirectory />;
}
