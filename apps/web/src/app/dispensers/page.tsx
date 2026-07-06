import type { Metadata } from "next";
import { IndexPage } from "@/components/index-page";
export const metadata: Metadata = { title: "Dispensers", description: "Recent Counterparty dispensers." };
export default function Page() {
  return <IndexPage name="dispensers" />;
}
