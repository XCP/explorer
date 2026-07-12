import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Fairminters", description: "Recent Counterparty fairminters." };
export default function Page() {
  return <IndexPage name="fairminters" />;
}
