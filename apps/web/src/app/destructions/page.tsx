import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Destructions", description: "Recent Counterparty asset destructions." };
export default function Page() {
  return <IndexPage name="destructions" />;
}
