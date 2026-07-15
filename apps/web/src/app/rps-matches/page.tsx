import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = {
  title: "RPS Matches",
  description: "Recent Counterparty rock-paper-scissors matches.",
};
export default function Page() {
  return <IndexPage name="rps_matches" />;
}
