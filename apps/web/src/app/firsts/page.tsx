import type { Metadata } from "next";
import { Firsts } from "@/components/firsts";
export const metadata: Metadata = {
  title: "Firsts",
  description: "The earliest of each kind of Counterparty on-chain moment.",
};
export default function Page() {
  return <Firsts />;
}
