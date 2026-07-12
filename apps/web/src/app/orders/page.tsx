import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Orders", description: "Recent Counterparty DEX orders." };
export default function Page() {
  return <IndexPage name="orders" />;
}
