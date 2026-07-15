import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Pool Matches", description: "Recent Counterparty pool matches." };
export default function Page() {
  return <IndexPage name="pool_matches" />;
}
