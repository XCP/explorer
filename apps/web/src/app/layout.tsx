import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SWRProvider } from "@/lib/swr-provider";
import { TopBar } from "@/components/top-bar";
import { Footer } from "@/components/footer";

// Match the xcpdex family: Geist sans (UI) + Geist mono (numbers/hashes/addresses).
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://xcp.io"),
  title: {
    default: "xcp.io — Counterparty Explorer",
    template: "%s | XCP.io",
  },
  description: "Explore Counterparty assets, addresses, blocks, and transactions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:rounded focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-sm focus:text-zinc-100">
          Skip to content
        </a>
        <SWRProvider>
          <div className="min-h-screen flex flex-col">
            <TopBar />
            <main id="main" className="flex-1 max-w-[1200px] w-full mx-auto p-4 space-y-6">{children}</main>
            <Footer />
          </div>
        </SWRProvider>
      </body>
    </html>
  );
}
