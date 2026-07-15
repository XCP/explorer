import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Cancels", description: "Recent Counterparty order cancellations." };
export default function Page() {
  return <IndexPage name="cancels" />;
}
