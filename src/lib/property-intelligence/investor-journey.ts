import type { AudienceMode, SurfaceKey } from "@/config/affiliate-vendors";
import type { PropertyCapabilities } from "./capabilities";
import type { AssessmentGoal, JourneyAvailability } from "./journey";

export interface RentalMoneyEvidence {
  value: number;
  rangeLow?: number | null;
  rangeHigh?: number | null;
  label: string;
  source: string;
  geography?: string;
  vintage?: number | null;
}

export interface RentalYieldEvidence {
  grossYieldPct: number;
  rentToPriceRatio: number;
  onePercentRuleMet: boolean;
}

export interface RentalScreenModel {
  availability: JourneyAvailability;
  addressRent: RentalMoneyEvidence | null;
  regionalRent: RentalMoneyEvidence | null;
  yield: RentalYieldEvidence | null;
}

export interface AssessmentAudience {
  mode: AudienceMode;
  surface: Extract<SurfaceKey, "result-buyer" | "result-investor">;
}

/**
 * CTA routing follows the user's explicit assessment goal only. Property
 * classification and occupancy evidence are intentionally not accepted.
 */
export function assessmentAudience(goal: AssessmentGoal | null | undefined): AssessmentAudience {
  return goal === "rental_investment"
    ? { mode: "investor", surface: "result-investor" }
    : { mode: "buyer", surface: "result-buyer" };
}

/**
 * Builds the P5 rental screen from already-fetched evidence. Capability
 * decisions are authoritative: supplied numbers are not shown when their
 * scope has not been verified, and this function can never fetch a provider.
 */
export function buildRentalScreenModel(args: {
  goal: AssessmentGoal | null | undefined;
  capabilities: PropertyCapabilities | null | undefined;
  addressRent?: RentalMoneyEvidence | null;
  regionalRent?: RentalMoneyEvidence | null;
  yield?: RentalYieldEvidence | null;
}): RentalScreenModel | null {
  if (args.goal !== "rental_investment") return null;

  const items = args.capabilities?.items;
  const addressRent = items?.addressRentEstimate.available ? args.addressRent ?? null : null;
  const regionalRent = items?.regionalRentBenchmark.available ? args.regionalRent ?? null : null;
  const yieldEvidence = items?.grossYieldScreen.available && addressRent ? args.yield ?? null : null;

  return {
    availability: addressRent && yieldEvidence ? "supported" : regionalRent ? "limited" : "unavailable",
    addressRent,
    regionalRent,
    yield: yieldEvidence,
  };
}
