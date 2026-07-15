import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Pools", description: "Counterparty automated market maker pools." };
export default function Page() {
  return <IndexPage name="pools" />;
}
