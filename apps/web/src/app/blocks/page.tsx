import type { Metadata } from "next";
import { BlocksList } from "@/components/blocks-list";

export const metadata: Metadata = {
  title: "Blocks",
  description: "Recent Bitcoin blocks with Counterparty activity.",
};

export default function BlocksPage() {
  return <BlocksList />;
}
