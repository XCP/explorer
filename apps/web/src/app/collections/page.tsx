import type { Metadata } from "next";
import { Collections } from "@/components/collections";
export const metadata: Metadata = {
  title: "Collections",
  description:
    "Counterparty collections and protocol families scored as a group — ranked by the median composed quality of their members.",
};
export default function Page() {
  return <Collections />;
}
