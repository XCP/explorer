import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Pool Deposits", description: "Recent Counterparty pool deposits." };
export default function Page() {
  return <IndexPage name="pool_deposits" />;
}
