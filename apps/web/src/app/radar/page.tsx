import type { Metadata } from "next";
import { Radar } from "@/components/radar";

export const metadata: Metadata = {
  title: "Counterparty Radar",
  description:
    "Explore early Counterparty market formation, recent launches, established holder evidence, and assets available on-chain.",
};

export default function Page() {
  return <Radar />;
}
