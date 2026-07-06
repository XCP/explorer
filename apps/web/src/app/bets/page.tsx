import type { Metadata } from "next";
import { IndexPage } from "@/components/index-page";
export const metadata: Metadata = { title: "Bets", description: "Recent Counterparty bets." };
export default function Page() {
  return <IndexPage name="bets" />;
}
