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
import { rolloutStripColumns, type RolloutStripColumn } from "@/config/insurance-rollout";

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
    body: "Continue to a licensed broker for your region to get your quote — your coverage profile stays saved with Property Insights. They're the broker of record, start to finish.",
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
      "Property Insights is not an insurance company, an insurer, or a broker — it's a property-intelligence platform that builds your coverage profile and matches you with a licensed broker to continue to. That broker provides the advice, the quote, and the actual policy; we never quote, bind, or sell insurance ourselves. Think of us as the paperwork layer that sits in front of the broker relationship, not a replacement for it.",
  },
  {
    question: "Who will my broker actually be?",
    answer:
      "Your broker will be a broker licensed in your province or state, acting as your broker of record for the policy. Property Insights matches you with a partner brokerage for your region rather than an individual agent you pick yourself, and you continue to them directly. That broker — not Property Insights — handles the quote, the advice, and the paperwork from there.",
  },
  {
    question: "Are you going to sell my info to a dozen agents?",
    answer:
      "No — Property Insights matches you with exactly one licensed broker for your region, not a list of agents, and your coverage profile stays saved with Property Insights unless and until you continue to that broker yourself. That's the difference between a single match and a lead auction: your information is never resold to a room of cold-callers chasing the same address. You'll only ever be routed to one broker, never a list.",
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
      "Getting a landlord insurance quote in Canada typically starts with basic facts about the rental property — its type, age, and size — plus details only you know, like occupancy status and unit count. Property Insights pre-fills the property facts it already tracks so you confirm rather than retype them, then matches you with a licensed broker in your province — you continue to them directly for the actual landlord policy. The broker of record provides the coverage advice and the quote; we build the profile and make the match.",
  },
  {
    question: "How fast can I get a home insurance quote in BC?",
    answer:
      "Because Property Insights already tracks many BC properties, your coverage profile can be ready in under a minute — you confirm what we know and add the handful of details only you can provide. From there, you continue to a licensed BC broker who provides the actual quote directly. Response times depend on that broker, not on us.",
  },
];

export type RolloutColumn = RolloutStripColumn;

// Derived from src/config/insurance-rollout.ts's CA_REGIONS (via
// rolloutStripColumns()) rather than hand-duplicated here — this used to be
// a standalone five-entry literal that could silently drift from the
// rollout config's actual live/next/soon statuses (the module-load
// consistency assertion in insurance-rollout.ts doesn't cover this list, so
// nothing else would have caught the drift). Single source of truth now;
// see that file's doc comment for the full rationale.
export const ROLLOUT_COLUMNS: RolloutColumn[] = rolloutStripColumns();
