import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Dispenses", description: "Recent Counterparty dispenses." };
export default function Page() {
  return <IndexPage name="dispenses" />;
}
