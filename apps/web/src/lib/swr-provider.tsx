"use client";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { fetcher } from "./api/client";

// Global SWR cache config — dedupe + cache so the explorer's traffic stays cheap and api.xcp.io stays calm.
export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false,
        revalidateIfStale: true,
        dedupingInterval: 15_000,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
