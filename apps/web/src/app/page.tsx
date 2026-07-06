import type { Metadata } from "next";
import { HomeDashboard } from "@/components/home-dashboard";

export const metadata: Metadata = {
  title: { absolute: "xcp.io — The Counterparty Blockchain Explorer" },
  description: "Explore Counterparty assets, addresses, blocks, and transactions — on Bitcoin since 2014.",
};

export default function Page() {
  return <HomeDashboard />;
}
