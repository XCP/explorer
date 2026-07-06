import type { Metadata } from "next";
import { IndexPage } from "@/components/index-page";
export const metadata: Metadata = { title: "Sends", description: "Recent Counterparty asset sends." };
export default function Page() {
  return <IndexPage name="sends" />;
}
