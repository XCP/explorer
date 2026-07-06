import type { Metadata } from "next";
import { IndexPage } from "@/components/index-page";
export const metadata: Metadata = { title: "Transactions", description: "Recent Counterparty transactions." };
export default function Page() {
  return <IndexPage name="transactions" />;
}
