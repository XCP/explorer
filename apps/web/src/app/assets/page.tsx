import type { Metadata } from "next";
import { AssetIndex } from "@/features/assets/components/asset-index";
export const metadata: Metadata = { title: "Assets", description: "Browse and search every Counterparty asset." };
export default function Page() {
  return <AssetIndex />;
}
