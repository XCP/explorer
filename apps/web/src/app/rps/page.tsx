import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "RPS Games", description: "Recent Counterparty rock-paper-scissors games." };
export default function Page() {
  return <IndexPage name="rps" />;
}
