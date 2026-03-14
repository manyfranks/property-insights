import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import NavbarSearch from "@/components/navbar-search";
import MobileSearch from "@/components/mobile-search";
import MobileNav from "@/components/mobile-nav";
import { OrganizationJsonLd } from "@/components/json-ld";
import Footer from "@/components/footer";
import ConsentBanner from "@/components/consent-banner";
import { BASE_URL, SITE_NAME, SITE_DESCRIPTION, SITE_LOCALE } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — Canadian Real Estate Offer Intelligence`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(BASE_URL),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: SITE_LOCALE,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Canadian Real Estate Offer Intelligence`,
    description: SITE_DESCRIPTION,
    url: BASE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Canadian Real Estate Offer Intelligence`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
    },
  },
  keywords: [
    "Canadian real estate",
    "property assessment",
    "home offer calculator",
    "real estate offer tool",
    "BC assessment",
    "Alberta property assessment",
    "Ontario property assessment",
    "home buying Canada",
    "below asking price",
    "real estate negotiation",
    "property analysis",
    "days on market",
    "seller motivation",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <OrganizationJsonLd url={BASE_URL} />
        <ClerkProvider>
          <header className="relative z-50 border-b border-border bg-white">
            <div className="relative max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                  <path d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9 17.5V14l3-3 3 4v5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="hidden sm:inline">Property Insights</span>
              </Link>
              <NavbarSearch />
              <MobileSearch />
              <MobileNav />
              <nav className="hidden sm:flex items-center gap-6 text-sm text-muted">
                <Link href="/how-it-works" className="hover:text-foreground transition-colors">
                  How it works
                </Link>
                <Link href="/dashboard" className="hover:text-foreground transition-colors">
                  Discover
                </Link>
                <Show when="signed-out">
                  <SignInButton mode="modal">
                    <button className="px-3 py-1 text-sm rounded-full border border-foreground text-foreground hover:bg-foreground hover:text-white transition-all">
                      Sign in
                    </button>
                  </SignInButton>
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </nav>
            </div>
          </header>
          {children}
          <Footer />
          <ConsentBanner />
        </ClerkProvider>
        <Analytics />
      </body>
    </html>
  );
}
