import type { AudienceMode, SurfaceKey } from "@/config/affiliate-vendors";
import type { CapabilityScope, PropertyCapabilities } from "./capabilities";
import type { AssessmentGoal, JourneyAvailability } from "./journey";
import { hasSubjectEvidenceGap } from "./journey";
import type { AssessmentSubject } from "./subject";

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

export interface RentCastValuationEvidenceScopes {
  saleValue: CapabilityScope;
  rentEstimate: CapabilityScope;
}

/**
 * RentCast documents intentionally different semantics for multi-family
 * AVMs: value is for the whole building, while long-term rent is for one
 * unit. Keep those scopes explicit so the two numbers can never be divided
 * into a fake whole-building yield.
 */
export function rentCastValuationEvidenceScopes(
  propertyType: string | null | undefined
): RentCastValuationEvidenceScopes | null {
  const normalized = propertyType?.trim().toLowerCase();
  return normalized === "multi-family" || normalized === "apartment"
    ? { saleValue: "building", rentEstimate: "unit" }
    : null;
}

export function buildUserRentScenario(
  price: number,
  monthlyRent: number
): RentalYieldEvidence | null {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(monthlyRent) || monthlyRent <= 0) {
    return null;
  }
  const rentToPriceRatio = monthlyRent / price;
  return {
    grossYieldPct: rentToPriceRatio * 12,
    rentToPriceRatio,
    onePercentRuleMet: rentToPriceRatio >= 0.01,
  };
}

export function monthlyRentForGrossYield(price: number, annualYieldPct: number): number | null {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(annualYieldPct) || annualYieldPct <= 0) {
    return null;
  }
  return price * annualYieldPct / 12;
}

export function shouldWithholdPropertyEvidence(
  subject: AssessmentSubject,
  capabilities: PropertyCapabilities | null | undefined
): boolean {
  return subject.requiresClarification || hasSubjectEvidenceGap(subject.scope, capabilities);
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
