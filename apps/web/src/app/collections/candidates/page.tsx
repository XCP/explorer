import type { Metadata } from "next";
import { CollectionCandidates } from "@/components/collection-candidates";
export const metadata: Metadata = {
  title: "Collection Candidates",
  description:
    "Undiscovered Counterparty projects — issuer clusters of media assets held by real collectors, not yet tagged as a collection.",
};
export default function Page() {
  return <CollectionCandidates />;
}
