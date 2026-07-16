import type { Metadata } from "next";
import { Collections } from "@/components/collections";
export const metadata: Metadata = {
  title: "Collections",
  description:
    "Descriptive profiles of Counterparty collections and protocol families, including membership, market coverage, holder breadth, and concentration.",
};
export default function Page() {
  return <Collections />;
}
