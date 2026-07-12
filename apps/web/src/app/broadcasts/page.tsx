import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Broadcasts", description: "Recent Counterparty broadcasts." };
export default function Page() {
  return <IndexPage name="broadcasts" />;
}
