import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Bet Matches", description: "Recent Counterparty bet matches." };
export default function Page() {
  return <IndexPage name="bet_matches" />;
}
