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
 * just string literals) — keep any edits framed as "continue to a licensed
 * insurance partner," never a ranked or superlative claim about insurers.
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
    body: "Continue to one licensed insurance partner for your region to explore coverage options — your coverage profile stays saved with Property Insights.",
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
      "Property Insights is not an insurance company, an insurer, an agency, or a brokerage — it's a property-intelligence platform that builds your coverage profile and matches you with a licensed insurance partner to continue to. That partner provides any advice, quote, or policy; we never quote, bind, or sell insurance ourselves. Think of us as the paperwork layer in front of that relationship, not a replacement for it.",
  },
  {
    question: "Who will my insurance partner actually be?",
    answer:
      "Property Insights matches you with a licensed insurance agency or brokerage configured for your region, rather than presenting a list of agents. You continue to that partner directly, and that partner — not Property Insights — is responsible for any quote, advice, policy, or service it provides.",
  },
  {
    question: "Are you going to sell my info to a dozen agents?",
    answer:
      "No — Property Insights matches you with exactly one licensed insurance partner for your region, not a list of agents, and your coverage profile stays saved with Property Insights unless and until you continue to that partner yourself. That's the difference between a single match and a lead auction: your information is never resold to a room of cold-callers chasing the same address. You'll only ever be routed to one partner, never a list.",
  },
  {
    question: "How does Property Insights make money, then?",
    answer:
      "Property Insights may earn money through a disclosed partner arrangement when a match leads to a policy — not from you directly. That compensation does not change the price you're quoted or influence the property analysis we show you. We disclose the arrangement here rather than burying it in fine print.",
  },
  {
    question: "Where can I actually use this?",
    answer:
      "Property Insights is live today in British Columbia, with Alberta and Ontario opening next, followed by the rest of Canada and a state-by-state U.S. rollout. Availability depends on both your region and which licensed insurance partners operate there. We detect your location automatically and show you exactly what's available where you are.",
  },
  {
    question: 'What do you mean you "already know" my property?',
    answer:
      "Property Insights already tracks many residential addresses, so if we recognize yours, your coverage profile starts pre-filled with facts like property type, year built, size, and an estimated value. You confirm what we know instead of retyping it, then add the handful of details — like occupancy and claims history — that only you can provide. Nothing about your property is guessed; anything we're not confident about is flagged for you to fill in.",
  },
  {
    question: "How does home insurance work in British Columbia?",
    answer:
      "In British Columbia, home insurance is arranged through a licensed insurance agency, brokerage, or insurer, not a government program — coverage, terms, and pricing come from that licensed provider. Property Insights builds your coverage profile from what we already track about the property, then matches you with one licensed BC insurance partner. We never quote, bind, or advise on coverage ourselves.",
  },
  {
    question: "What do I need to get landlord insurance in Canada?",
    answer:
      "Getting a landlord insurance quote in Canada typically starts with basic facts about the rental property — its type, age, and size — plus details only you know, like occupancy status and unit count. Property Insights pre-fills the property facts it already tracks so you confirm rather than retype them, then matches you with a licensed insurance partner in your province. You continue to that partner directly for any coverage advice, quote, or policy; we build the profile and make the match.",
  },
  {
    question: "How fast can I get a home insurance quote in BC?",
    answer:
      "Because Property Insights already tracks many BC properties, your coverage profile can be ready in under a minute — you confirm what we know and add the handful of details only you can provide. From there, you continue to a licensed BC insurance partner for the actual quote. Response times depend on that partner and the risk, not on us.",
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
