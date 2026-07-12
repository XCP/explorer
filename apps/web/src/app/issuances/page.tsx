import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Issuances", description: "Recent Counterparty asset issuances." };
export default function Page() {
  return <IndexPage name="issuances" />;
}
