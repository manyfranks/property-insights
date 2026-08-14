import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import Image from "next/image";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import NavbarSearch from "@/components/navbar-search";
import MobileNav from "@/components/mobile-nav";
import { OrganizationJsonLd, OrganizationEntityJsonLd } from "@/components/json-ld";
import Footer from "@/components/footer";
import ConsentBanner from "@/components/consent-banner";
import GpcHonor from "@/components/gpc-honor";
import PostHogIdentify from "@/components/posthog-identify";
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
    default: `${SITE_NAME} — Real Estate Offer Intelligence`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(BASE_URL),
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: SITE_LOCALE,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Real Estate Offer Intelligence`,
    description: SITE_DESCRIPTION,
    url: BASE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Real Estate Offer Intelligence`,
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
    "real estate offer intelligence",
    "property assessment",
    "home offer calculator",
    "real estate offer tool",
    "BC assessment",
    "Alberta property assessment",
    "Ontario property assessment",
    "county property assessment",
    "home buying Canada",
    "US home values",
    "home buying USA",
    "below asking price",
    "real estate negotiation",
    "property analysis",
    "days on market",
    "seller motivation",
  ],
};

export const viewport: Viewport = {
  themeColor: "#fafafa",
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
        {/* Impact affiliate-network site verification. Their scanner expects the
            nonstandard value= attribute (not content=), so this is a raw tag —
            React hoists it into <head> — rather than metadata.other. */}
        <meta name="impact-site-verification" {...{ value: "0ace5bae-67e1-46b6-8692-148801f40b03" }} />
        <meta name="impact-site-verification" {...{ value: "eabea977-5970-488e-8500-e9900ed31327" }} />
        <meta name="impact-site-verification" {...{ value: "1d89ecb8-4d2f-4c48-a3ca-4da67527c699" }} />
        {/* FlexOffers site verification (standard content= attribute). */}
        <meta name="fo-verify" content="f7a80bd4-10ee-4813-941a-6be2253e7186" />
        <OrganizationEntityJsonLd url={BASE_URL} />
        <OrganizationJsonLd url={BASE_URL} />
        <ClerkProvider>
          <PostHogIdentify />
          <header className="relative z-50 border-b border-border bg-white">
            <div className="relative max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground" aria-label="Property Insights home">
                <Image src="/logo.png" alt="Property Insights" width={20} height={20} className="shrink-0" />
                <span className="text-sm sm:text-base">Property Insights</span>
              </Link>
              <NavbarSearch />
              <MobileNav />
              <nav className="hidden sm:flex items-center gap-6 text-sm text-muted">
                <Link href="/how-it-works" className="hover:text-foreground transition-colors">
                  How it works
                </Link>
                <Link href="/dashboard" className="hover:text-foreground transition-colors">
                  Discover
                </Link>
                <Link href="/insurance" className="hover:text-foreground transition-colors">
                  Insurance
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
          <GpcHonor />
        </ClerkProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
