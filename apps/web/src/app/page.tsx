import type { Metadata } from "next";
import { HomeDashboard } from "@/components/home-dashboard";

export const metadata: Metadata = {
  title: { absolute: "xcp.io — The Counterparty Blockchain Explorer" },
  description: "Explore Counterparty culture, collections, grails, collectors, and twelve years of history on Bitcoin.",
};

export default function Page() {
  return <HomeDashboard />;
}
