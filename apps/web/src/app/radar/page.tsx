import type { Metadata } from "next";
import { Radar } from "@/components/radar";
export const metadata: Metadata = {
  title: "Radar — Undervalued Grails",
  description: "Assets the smart money holds that the market hasn't priced — ranked by Conviction, a holder-and-scarcity score with no market inputs.",
};
export default function Page() {
  return <Radar />;
}
