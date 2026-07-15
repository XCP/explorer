import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Pool Withdrawals", description: "Recent Counterparty pool withdrawals." };
export default function Page() {
  return <IndexPage name="pool_withdrawals" />;
}
