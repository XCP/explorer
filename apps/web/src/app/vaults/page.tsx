import type { Metadata } from "next";
import { Vaults } from "@/components/vaults";
export const metadata: Metadata = { title: "Emblem Vaults", description: "Counterparty assets wrapped as Emblem Vault NFTs." };
export default function Page() {
  return <Vaults />;
}
