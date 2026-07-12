import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Fairmints", description: "Recent Counterparty fairmints." };
export default function Page() {
  return <IndexPage name="fairmints" />;
}
