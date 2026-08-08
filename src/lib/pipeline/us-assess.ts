/**
 * pipeline/us-assess.ts
 *
 * Maps a RentCast USPropertyBundle (src/lib/rentcast.ts) into the shapes the
 * shared scoring/offer pipeline expects (Listing, Assessment — see
 * src/lib/types.ts), and computes comp support directly from AVM comps.
 *
 * This is the US analogue of src/lib/zoocasa.ts's listing mappers: Zoocasa
 * gives street-level MLS remarks (description text) that the signal/offer
 * engine mines for keywords ("motivated seller", "estate sale", etc.).
 * RentCast's free-tier endpoints don't return MLS remarks at all — so
 * `description`/`notes` are always empty for US listings, and every
 * text-keyword signal in signals.ts/scoring.ts/offer-model.ts simply never
 * fires. What *does* carry over: DOM-based scoring, building-age scoring,
 * and priceReduced (derived structurally from RentCast's price history,
 * not from text) — genuinely comparable to the CA pipeline, just thinner.
 * This is documented here rather than silently patched over.
 *
 * Comparables shortcut: matchComparables() (src/lib/comparables.ts) is
 * tightly coupled to Zoocasa's sold-listing shape (ZoocasaSoldRaw) and
 * calls fetchSoldDetail() to enrich top candidates — a Zoocasa-specific
 * network call with no RentCast equivalent, and forcing AVM comps through
 * that pipeline would mean fabricating soldPrice/soldAt/listPrice fields
 * RentCast's AVM comps don't actually provide (they're valuation
 * comparables — price + correlation + distance — not confirmed sold
 * transactions). Per the task's own fallback clause, comp support is
 * computed directly from the AVM's `comparables[]` (already returned by
 * the /avm/value call — zero extra RentCast requests) into a separate,
 * honestly-labeled UsCompSupport shape instead of forcing ComparableResult.
 */

import type { Assessment, Listing } from "../types";
import type { RentCastAvm, RentCastPropertyRecord, USPropertyBundle } from "../rentcast";
import { assessmentBasisForState } from "../rentcast";

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/** Tax assessments older than this are treated as stale — prefer the AVM. */
const STALE_ASSESSMENT_YEARS = 3;

/**
 * Anchor priority: tax-assessed value (observed, government-sourced) when
 * recent; RentCast's AVM (modeled) when the tax record is missing or stale.
 * Returns null only when RentCast had neither for this address.
 */
export function buildUsAssessment(
  record: RentCastPropertyRecord | null,
  avm: RentCastAvm | null,
  state: string
): Assessment | null {
  const latestTax = record?.taxAssessments?.[0];
  const currentYear = new Date().getFullYear();
  const isStale = !latestTax || currentYear - latestTax.year > STALE_ASSESSMENT_YEARS;

  if (latestTax && latestTax.value && !isStale) {
    return {
      totalValue: latestTax.value,
      landValue: latestTax.land ?? 0,
      buildingValue: latestTax.improvements ?? 0,
      assessmentYear: String(latestTax.year),
      found: true,
      source: "government",
      evidenceClass: "observed",
      assessmentBasis: assessmentBasisForState(state),
    };
  }

  if (avm?.value) {
    return {
      totalValue: avm.value,
      landValue: 0,
      buildingValue: 0,
      assessmentYear: String(currentYear),
      found: true,
      source: "avm",
      evidenceClass: "modeled",
      assessmentBasis: "market_value",
    };
  }

  // Stale/missing tax record with no AVM to fall back on — still surface
  // the stale record rather than nothing, honestly labeled as such.
  if (latestTax && latestTax.value) {
    return {
      totalValue: latestTax.value,
      landValue: latestTax.land ?? 0,
      buildingValue: latestTax.improvements ?? 0,
      assessmentYear: String(latestTax.year),
      found: true,
      source: "government",
      evidenceClass: "observed",
      assessmentBasis: assessmentBasisForState(state),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * Build a Listing-shaped object from a RentCast bundle with an active
 * listing. Fields with no RentCast equivalent (description, notes,
 * hasSuite, estateKeywords, cluster, url) are left at their honest empty
 * defaults — see the module doc comment for why.
 */
export function buildUsListing(bundle: USPropertyBundle, city: string, state: string): Listing {
  const al = bundle.activeListing!;
  const record = bundle.record;

  const address = al.addressLine1 || record?.addressLine1 || al.formattedAddress?.split(",")[0]?.trim() || "";

  const beds = al.bedrooms ?? record?.bedrooms ?? null;
  const baths = al.bathrooms ?? record?.bathrooms ?? null;
  const sqft = al.squareFootage ?? record?.squareFootage ?? null;
  const yearBuilt = record?.yearBuilt ?? null;

  // Structural price-reduced signal: RentCast's priceHistory event log,
  // not text — compares the current price to the first tracked price.
  let priceReduced = false;
  if (al.priceHistory.length > 1) {
    const first = al.priceHistory[0].price;
    const current = al.price ?? al.priceHistory[al.priceHistory.length - 1].price;
    if (first && current && current < first) priceReduced = true;
  }

  const latestTax = record?.propertyTaxes?.[0]?.total ?? record?.taxAssessments?.[0]?.value ?? null;

  return {
    address,
    city: al.city || city,
    province: (al.state || state || "").toUpperCase(),
    dom: al.daysOnMarket ?? 0,
    price: al.price ?? 0,
    beds: beds != null ? String(beds) : "",
    baths: baths != null ? String(baths) : "",
    sqft: sqft != null ? String(sqft) : "",
    yearBuilt: yearBuilt != null ? String(yearBuilt) : "",
    taxes: latestTax != null ? String(Math.round(latestTax)) : "",
    lotSize: record?.lotSize != null ? String(record.lotSize) : "",
    priceReduced,
    // No MLS remarks available from RentCast's free-tier endpoints — these
    // keyword-driven signals structurally can't be detected for US listings.
    hasSuite: false,
    estateKeywords: false,
    description: "",
    notes: "",
    cluster: "",
    url: "",
    mlsNumber: al.mlsNumber || undefined,
  };
}

// ---------------------------------------------------------------------------
// Comp support (shortcut — see module doc comment)
// ---------------------------------------------------------------------------

export interface UsCompSupportEntry {
  address: string | null;
  price: number | null;
  distanceMi: number | null;
  correlation: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  status: string | null;
}

export interface UsCompSupport {
  source: "rentcast_avm";
  comparables: UsCompSupportEntry[];
  medianPricePerSqft: number | null;
  impliedValue: number | null;
  confidence: "high" | "medium" | "low" | "none";
  marketNote: string;
  dataGaps: string[];
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Comp support computed directly from the AVM's own comparables[] — no
 * extra RentCast requests (this data rides along with the /avm/value call
 * already made in getUSProperty). Not a sold-comp match like
 * matchComparables(): RentCast's AVM comps are valuation inputs (price +
 * correlation + distance), a mix of recently sold and active listings, not
 * confirmed sold-to-list transactions — hence the separate type and the
 * "rentcast_avm" source tag rather than pretending this is ComparableResult.
 *
 * See also src/lib/pipeline/us-advantage.ts — the sibling module that turns
 * this file's outputs (plus the RentCast bundle's sale/tax history) into
 * the equity/tenure, triangulation, yield, risk/momentum, and
 * over-assessment signals that have no CA equivalent.
 */
export function buildUsCompSupport(avm: RentCastAvm | null, subjectSqft: number): UsCompSupport {
  const dataGaps: string[] = [];
  if (!avm || avm.comps.length === 0) {
    return {
      source: "rentcast_avm",
      comparables: [],
      medianPricePerSqft: null,
      impliedValue: null,
      confidence: "none",
      marketNote: "No comparable data returned by RentCast's AVM for this address.",
      dataGaps: ["No AVM comparables available"],
    };
  }

  const comps = avm.comps.slice(0, 8).map((c) => ({
    address: c.formattedAddress,
    price: c.price,
    distanceMi: c.distanceMi,
    correlation: c.correlation,
    sqft: c.squareFootage,
    beds: c.bedrooms,
    baths: c.bathrooms,
    status: c.status,
  }));

  const ppsf = avm.comps
    .filter((c) => c.price && c.squareFootage && c.squareFootage > 0)
    .map((c) => c.price! / c.squareFootage!);
  const medianPricePerSqft = ppsf.length ? Math.round(median(ppsf)) : null;
  if (!ppsf.length) dataGaps.push("Comp square footage not reported — no $/sqft available");

  const impliedValue =
    medianPricePerSqft && subjectSqft > 0 ? Math.round((medianPricePerSqft * subjectSqft) / 1000) * 1000 : null;
  if (!subjectSqft) dataGaps.push("Subject sqft not reported");

  const avgCorrelation = median(avm.comps.filter((c) => c.correlation != null).map((c) => c.correlation!));
  let confidence: UsCompSupport["confidence"];
  if (avm.comps.length >= 5 && ppsf.length >= 3 && avgCorrelation >= 0.7) confidence = "high";
  else if (avm.comps.length >= 3) confidence = "medium";
  else confidence = "low";

  let marketNote = `${avm.comps.length} comparable propert${avm.comps.length === 1 ? "y" : "ies"} from RentCast's AVM.`;
  if (impliedValue) marketNote += ` Comp-implied value: $${impliedValue.toLocaleString()}.`;

  return {
    source: "rentcast_avm",
    comparables: comps,
    medianPricePerSqft,
    impliedValue,
    confidence,
    marketNote,
    dataGaps,
  };
}
