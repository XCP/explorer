import type { Metadata } from "next";
import { IndexPage } from "@/components/index-page";
export const metadata: Metadata = { title: "Broadcasts", description: "Recent Counterparty broadcasts." };
export default function Page() {
  return <IndexPage name="broadcasts" />;
}
