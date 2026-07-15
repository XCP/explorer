import type { Metadata } from "next";
import { Recovery } from "@/components/recovery";

export const metadata: Metadata = {
  title: "Recover Bitcoin",
  description: "Find and recover Bitcoin held in old Counterparty bare-multisig outputs.",
};

export default function Page() {
  return <Recovery />;
}
