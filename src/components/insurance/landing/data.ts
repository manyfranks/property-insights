/**
 * components/insurance/landing/data.ts
 *
 * Copy + structured data shared across the /insurance landing sections —
 * kept framework-neutral (no JSX) so the FAQ section and the route's
 * FAQPage JSON-LD (src/app/insurance/page.tsx) render from the exact same
 * source instead of two copies that can drift apart.
 *
 * Scanned by scripts/check-insurance-copy.ts along with every other file
 * under src/components/insurance/ (including this file's own comments, not
 * just string literals) — keep any edits framed as "get matched with a
 * licensed broker," never a ranked or superlative claim about insurers.
 */

import type { InsuranceLine } from "@/config/affiliate-vendors";

export interface CoverageLineInfo {
  id: InsuranceLine;
  label: string;
  blurb: string;
}

export const COVERAGE_LINES: CoverageLineInfo[] = [
  { id: "homeowner", label: "Homeowner", blurb: "Owner-occupied — dwelling, contents, and liability." },
  { id: "landlord", label: "Landlord", blurb: "Rental property — building, loss of rent, liability." },
  { id: "tenant", label: "Tenant", blurb: "Contents and liability in a unit you don't own." },
  { id: "strata", label: "Strata / condo", blurb: "The building-level master policy for a strata or condo board." },
  { id: "commercial", label: "Commercial", blurb: "Mixed-use and commercial — property and business interruption." },
];

export interface TrustCard {
  title: string;
  body: string;
}

/** From the design file's unused `trustCards` data. */
export const TRUST_CARDS: TrustCard[] = [
  {
    title: "A layer, not an insurer",
    body: "We don't quote or bind. You're always placed with a licensed broker of record — we just make the match and pass along what we already know.",
  },
  {
    title: "One match, never resold",
    body: "Your profile goes to a single licensed broker for your region — not auctioned to a room of cold-callers. No spam, no ten follow-up calls.",
  },
  {
    title: "We disclose how we're paid",
    body: "Property Insights may earn a referral fee from a match. It never changes the price you pay, and it never touches our analysis.",
  },
];

export interface HowStep {
  num: string;
  title: string;
  body: string;
}

// The wizard (src/components/insurance/coverage-profile-wizard.tsx) collects
// exactly six things no dataset can supply, across its 4 steps: coverage
// line, occupancy, unit count, claims (5yr), roof/systems age, and coverage
// renewal date — contact info (name/email) is "where to reach you," not an
// underwriting question, so it isn't counted here. Verified against the
// wizard's actual fields (not assumed) — see STEP_META / OCCUPANCY_OPTIONS /
// UNIT_COUNT_OPTIONS / CLAIMS_OPTIONS / ROOF_AGE_OPTIONS in that file.
export const HOW_STEPS: HowStep[] = [
  {
    num: "01",
    title: "Confirm the property",
    body: "We fill in what we already track — value, size, year built. You fix anything that's off. Most people don't.",
  },
  {
    num: "02",
    title: "Answer six questions",
    body: "Coverage type, occupancy, claims history, coverage dates — the handful of things no dataset can supply. About thirty seconds.",
  },
  {
    num: "03",
    title: "Get matched",
    body: "A licensed broker for your region picks it up with your profile on file. They're the broker of record, start to finish.",
  },
];

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Wait — is Property Insights an insurance company?",
    answer:
      "Property Insights is not an insurance company, an insurer, or a broker — it's a property-intelligence platform that builds your coverage profile and hands it to a licensed broker. That broker provides the advice, the quote, and the actual policy; we never quote, bind, or sell insurance ourselves. Think of us as the paperwork layer that sits in front of the broker relationship, not a replacement for it.",
  },
  {
    question: "Who will my broker actually be?",
    answer:
      "Your broker will be a broker licensed in your province or state, acting as your broker of record for the policy. Property Insights routes your coverage profile to a partner brokerage for your region rather than to an individual agent you pick yourself. That broker — not Property Insights — handles the quote, the advice, and the paperwork from there.",
  },
  {
    question: "Are you going to sell my info to a dozen agents?",
    answer:
      "No — Property Insights sends your coverage profile to exactly one licensed broker for your region, not a list of agents. That's the difference between a single match and a lead auction: your information is never resold to a room of cold-callers chasing the same address. You'll hear from one broker, once.",
  },
  {
    question: "How does Property Insights make money, then?",
    answer:
      "Property Insights earns money through disclosed referral arrangements with the licensed brokers we match you with — not from you directly. That referral fee never changes the price you pay for coverage, and it never influences the property analysis we show you. We disclose the arrangement here rather than burying it in fine print.",
  },
  {
    question: "Where can I actually use this?",
    answer:
      "Property Insights is live today in British Columbia, with Alberta and Ontario opening next, followed by the rest of Canada and a state-by-state U.S. rollout. Availability depends on both your region and which licensed brokers operate there. We detect your location automatically and show you exactly what's available where you are.",
  },
  {
    question: 'What do you mean you "already know" my property?',
    answer:
      "Property Insights already tracks many residential addresses, so if we recognize yours, your coverage profile starts pre-filled with facts like property type, year built, size, and an estimated value. You confirm what we know instead of retyping it, then add the handful of details — like occupancy and claims history — that only you can provide. Nothing about your property is guessed; anything we're not confident about is flagged for you to fill in.",
  },
  {
    question: "How does home insurance work in British Columbia?",
    answer:
      "In British Columbia, home insurance is arranged through a licensed broker or insurer, not a government program — coverage, terms, and pricing come directly from that broker. Property Insights builds your coverage profile from what we already track about the property, then matches you with a single licensed BC broker who handles the quote and the policy. We never quote, bind, or advise on coverage ourselves.",
  },
  {
    question: "What do I need to get landlord insurance in Canada?",
    answer:
      "Getting a landlord insurance quote in Canada typically starts with basic facts about the rental property — its type, age, and size — plus details only you know, like occupancy status and unit count. Property Insights pre-fills the property facts it already tracks so you confirm rather than retype them, then routes your profile to a licensed broker in your province who handles the actual landlord policy. The broker of record provides the coverage advice and the quote; we build the profile and make the match.",
  },
  {
    question: "How fast can I get a home insurance quote in BC?",
    answer:
      "Because Property Insights already tracks many BC properties, your coverage profile can be ready in under a minute — you confirm what we know and add the handful of details only you can provide. From there, a licensed BC broker picks up your profile and provides the actual quote directly. Response times depend on that broker, not on us.",
  },
];

export interface RolloutColumn {
  label: string;
  country: string;
  status: string;
  live: boolean;
}

export const ROLLOUT_COLUMNS: RolloutColumn[] = [
  { label: "British Columbia", country: "Canada", status: "Live now", live: true },
  { label: "Alberta", country: "Canada", status: "Next", live: false },
  { label: "Ontario", country: "Canada", status: "After that", live: false },
  // QC + NB are permanently excluded (see INSURANCE_STATE_EXCLUSIONS) — "most
  // provinces" rather than "rest of Canada" so this column stays honest
  // about the two that aren't coming.
  { label: "Most provinces", country: "Rest of Canada", status: "Rolling out", live: false },
  { label: "United States", country: "Geo-targeted", status: "Rolling out", live: false },
];
