import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Dividends", description: "Recent Counterparty dividends." };
export default function Page() {
  return <IndexPage name="dividends" />;
}
