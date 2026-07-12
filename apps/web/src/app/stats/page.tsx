import type { Metadata } from "next";
import { NetworkStats } from "@/components/network-stats";
export const metadata: Metadata = {
  title: "Network Stats",
  description: "Counterparty chain totals and lifetime deflation.",
};
export default function Page() {
  return <NetworkStats />;
}
