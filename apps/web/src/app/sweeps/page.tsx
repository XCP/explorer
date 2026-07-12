import type { Metadata } from "next";
import { IndexPage } from "@/features/records/components/index-page";
export const metadata: Metadata = { title: "Sweeps", description: "Recent Counterparty sweeps." };
export default function Page() {
  return <IndexPage name="sweeps" />;
}
