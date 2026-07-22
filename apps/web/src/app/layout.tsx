import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import { SWRProvider } from "@/lib/swr-provider";
import { TopBar } from "@/components/chrome/top-bar";
import { Footer } from "@/components/chrome/footer";
import { FATHOM_SITE_ID } from "@/lib/fathom";

// Match the xcpdex family: Geist sans (UI) + Geist mono (numbers/hashes/addresses).
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://xcp.io"),
  icons: { icon: "https://cdn.xcp.io/img/full/XCP" },
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
        {/* Warm the connections on the critical path: the art CDN (LCP images) and the API origin (client
            SWR reads). React hoists these to <head>. crossOrigin on the API since its fetches are CORS. */}
        <link rel="preconnect" href="https://cdn.xcp.io" />
        <link rel="preconnect" href="https://api.xcp.io" crossOrigin="anonymous" />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:rounded focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-sm focus:text-zinc-100"
        >
          Skip to content
        </a>
        <SWRProvider>
          <div className="min-h-screen flex flex-col">
            <TopBar />
            <main id="main" className="flex-1 max-w-[1200px] w-full mx-auto p-4 space-y-6">
              {children}
            </main>
            <Footer />
          </div>
        </SWRProvider>
        {/* Fathom (privacy-first, cookieless; auto-tracks SPA navigation). Production only so dev
            sessions and preview origins don't pollute the numbers; events via lib/fathom trackEvent. */}
        {process.env.NODE_ENV === "production" && (
          <Script src="https://cdn.usefathom.com/script.js" data-site={FATHOM_SITE_ID} strategy="afterInteractive" />
        )}
      </body>
    </html>
  );
}
