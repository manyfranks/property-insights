import type { Metadata } from "next";
import type { Country, Vertical } from "@/config/affiliate-vendors";
import { AFFILIATE_VENDORS } from "@/config/affiliate-vendors";
import { BreadcrumbJsonLd } from "@/components/json-ld";
import { BASE_URL } from "@/lib/seo";
import ResourcesList, { type ResourceSection } from "./resources-list";

/**
 * /resources — "tools we use" page, REtipster pattern (docs/plans/11-CTA-
 * OPTIMIZATION-PLAYBOOK.md, section 3, "/resources page"). Registry-driven
 * and zero-maintenance: every section below is derived from
 * AFFILIATE_VENDORS at request time, so a vendor going enabled: true is the
 * only change needed to add or remove a card here.
 */

export const metadata: Metadata = {
  title: "Real Estate Tools We Use and Recommend (2026) | Property Insights",
  description:
    "The mortgage, insurance, investor, and tax-appeal tools we actually point home buyers and investors to — organized by what each one solves.",
  alternates: { canonical: "/resources" },
};

// Fixed display order per the CTA playbook; a section only renders when at
// least one `enabled` vendor exists for that vertical.
const VERTICAL_SECTIONS: { vertical: Vertical; label: string }[] = [
  { vertical: "investor-tools", label: "Investor tools" },
  { vertical: "mortgage", label: "Mortgage" },
  { vertical: "insurance", label: "Insurance" },
  { vertical: "tax-appeal", label: "Tax appeal" },
  { vertical: "home-services", label: "Home services" },
  { vertical: "agent-referral", label: "Agent referral" },
];

// Within a vertical section, US vendors list before Canadian ones.
const COUNTRY_ORDER: Record<Country, number> = { US: 0, CA: 1 };

export default function ResourcesPage() {
  const sections: ResourceSection[] = VERTICAL_SECTIONS.map(({ vertical, label }) => ({
    vertical,
    label,
    vendors: AFFILIATE_VENDORS.filter((v) => v.enabled && v.vertical === vertical).sort(
      (a, b) => COUNTRY_ORDER[a.country] - COUNTRY_ORDER[b.country]
    ),
  })).filter((section) => section.vendors.length > 0);

  return (
    <main className="max-w-3xl mx-auto px-6 py-8 sm:py-16">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: BASE_URL },
          { name: "Recommended Tools", url: `${BASE_URL}/resources` },
        ]}
      />

      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
        Tools we use and recommend
      </h1>
      <p className="text-sm text-muted leading-relaxed mb-10">
        The mortgage, insurance, and investor tools we point buyers and investors to most often —
        organized by what they solve, not by who pays us the most.
      </p>

      <ResourcesList sections={sections} />
    </main>
  );
}
