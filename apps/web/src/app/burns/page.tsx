import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Burns", description: "Counterparty proof-of-burn history." };
export default function Page() {
  return <IndexPage name="burns" />;
}
