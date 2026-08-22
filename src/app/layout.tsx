import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MarketplaceHeader } from "@/components/marketplace/marketplace-header";
import { WalletProvider } from "@/components/marketplace/wallet-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "LoopList marketplace", template: "%s · LoopList" },
  description: "Photo-grounded resale listings for electronics and footwear.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <WalletProvider>
          <MarketplaceHeader />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
