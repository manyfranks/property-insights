/**
 * JSON-LD structured data components for SEO.
 */

interface JsonLdProps {
  data: Record<string, unknown>;
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/** Organization schema — rendered once in root layout */
export function OrganizationJsonLd({ url }: { url: string }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "Property Insights",
        description:
          "AI-powered property analysis tool for Canadian home buyers. Get assessed values, offer price modeling, and listing intelligence.",
        url,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Any",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "CAD",
        },
      }}
    />
  );
}

/** BreadcrumbList schema */
export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[];
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, i) => ({
          "@type": "ListItemElement",
          position: i + 1,
          name: item.name,
          item: item.url,
        })),
      }}
    />
  );
}

/** FAQPage schema — used on how-it-works, blog posts, etc. */
export function FaqJsonLd({
  questions,
}: {
  questions: { question: string; answer: string }[];
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: questions.map((q) => ({
          "@type": "Question",
          name: q.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: q.answer,
          },
        })),
      }}
    />
  );
}

/** RealEstateListing schema for property pages */
export function PropertyJsonLd({
  url,
  address,
  city,
  province,
  beds,
  baths,
  price,
  description,
}: {
  url: string;
  address: string;
  city: string;
  province: string;
  beds: string;
  baths: string;
  price: number;
  description?: string;
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "RealEstateListing",
        name: `${address}, ${city} ${province}`,
        url,
        ...(description && { description }),
        about: {
          "@type": "SingleFamilyResidence",
          address: {
            "@type": "PostalAddress",
            streetAddress: address,
            addressLocality: city,
            addressRegion: province,
            addressCountry: "CA",
          },
          numberOfBedrooms: parseInt(beds) || undefined,
          numberOfBathroomsTotal: parseInt(baths) || undefined,
        },
        offers: {
          "@type": "Offer",
          price: price,
          priceCurrency: "CAD",
        },
      }}
    />
  );
}
