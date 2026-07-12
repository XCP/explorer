import type { Metadata } from "next";
import { Leaderboards } from "@/components/leaderboards";
export const metadata: Metadata = {
  title: "Leaderboards",
  description: "Counterparty's top creators, collectors, assets, and reputation.",
};
export default function Page() {
  return <Leaderboards />;
}
