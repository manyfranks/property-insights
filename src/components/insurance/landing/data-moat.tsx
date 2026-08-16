/**
 * components/insurance/landing/data-moat.tsx
 *
 * "The data moat" navy section. Renders a REAL tracked listing pulled
 * server-side from KV for the visitor's region — never a hardcoded fake
 * property — via buildCoveragePrefill (src/components/insurance/coverage-prefill.ts),
 * the exact same function the coverage-profile wizard uses, so the card
 * shows precisely what the wizard would actually pre-fill. No hazard row:
 * CoveragePrefill has no hazard field (the wizard always submits
 * hazards:{flood:null,wildfire:null,wind:null} — see
 * coverage-profile-wizard.tsx), so showing one here would be fabricated.
 *
 * Field count: buildCoveragePrefill can populate exactly 6 fields —
 * identity.type, identity.yearBuilt, identity.beds, identity.baths,
 * identity.sqft, and value.estimatedValue. value.estimatedRent is
 * hardcoded null unconditionally in coverage-prefill.ts ("Listing carries
 * no rent-estimate field today") and can never be populated, so it's
 * excluded from this count — the design's original copy said "12 fields
 * deep," which doesn't match the real prefill capability, so this section
 * says 6.
 */

import { getAllListings } from "@/lib/kv/listings";
import {
  buildCoveragePrefill,
  formatMoney,
  formatSize,
  type CoveragePrefill,
} from "@/components/insurance/coverage-prefill";
import type { Country } from "@/config/affiliate-vendors";
import type { Listing } from "@/lib/types";

export const PREFILL_FIELD_COUNT = 6;

const CA_PROVINCE_CODES = new Set(["BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL", "YT", "NT", "NU"]);

/** Prefers a listing with the richest known set of fields in the visitor's
 *  region, then falls back progressively (in-country, then any listing at
 *  all) rather than ever fabricating one. Returns null only when KV has no
 *  listings whatsoever. */
function pickShowcaseListing(listings: Listing[], country: Country, region: string): Listing | null {
  if (listings.length === 0) return null;

  const richness = (l: Listing): number =>
    [l.yearBuilt, l.beds, l.baths, l.sqft].filter((v) => v && v.trim().length > 0).length +
    (l.preAssessment?.found && typeof l.preAssessment.totalValue === "number" && l.preAssessment.totalValue > 0
      ? 1
      : 0);

  const inCountry = (l: Listing) => {
    const isCA = CA_PROVINCE_CODES.has(l.province.toUpperCase());
    return country === "CA" ? isCA : !isCA;
  };

  const upperRegion = region.toUpperCase();
  const inRegion = listings.filter((l) => l.province.toUpperCase() === upperRegion);
  const countryPool = listings.filter(inCountry);

  const pool = inRegion.length > 0 ? inRegion : countryPool.length > 0 ? countryPool : listings;
  return [...pool].sort((a, b) => richness(b) - richness(a))[0] ?? null;
}

type RowTag = "Known" | "Modeled" | "You add";

const TAG_STYLE: Record<RowTag, { tagColor: string; tagBg: string }> = {
  Known: { tagColor: "#0f766e", tagBg: "#e6f1ef" },
  Modeled: { tagColor: "#6b7280", tagBg: "#f1f1ef" },
  "You add": { tagColor: "#a16207", tagBg: "#faf1dd" },
};

function buildFieldRows(prefill: CoveragePrefill): { label: string; value: string; tag: RowTag }[] {
  const rows: { label: string; value: string; tag: RowTag }[] = [];
  const { identity, value } = prefill;

  if (identity.type) rows.push({ label: "Property type", value: identity.type, tag: "Known" });
  if (identity.yearBuilt !== null) rows.push({ label: "Year built", value: String(identity.yearBuilt), tag: "Known" });
  if (identity.sqft !== null) rows.push({ label: "Size", value: `${identity.sqft.toLocaleString("en-US")} sqft`, tag: "Known" });
  if (identity.beds !== null || identity.baths !== null) {
    rows.push({ label: "Beds / baths", value: formatSize(null, identity.beds, identity.baths), tag: "Known" });
  }
  if (value.estimatedValue !== null) {
    rows.push({ label: "Estimated value", value: formatMoney(value.estimatedValue, prefill.country), tag: "Modeled" });
  }
  // These two rows are never sourced from the listing — the wizard doesn't
  // have an occupancy or claims-history field to prefill from (see the
  // module docstring re: hazards). They exist to show the "you add" amber
  // state the design specifies, with the design's own static "Confirm"
  // placeholder value rather than any invented per-listing data.
  rows.push({ label: "Occupancy", value: "Confirm", tag: "You add" });
  rows.push({ label: "Claims (5 yr)", value: "Confirm", tag: "You add" });
  return rows;
}

export default async function DataMoat({ country, region }: { country: Country; region: string }) {
  let listing: Listing | null = null;
  let kvError = false;
  try {
    const listings = await getAllListings();
    listing = pickShowcaseListing(listings, country, region);
  } catch {
    kvError = true;
  }

  const prefill = listing
    ? buildCoveragePrefill({
        country,
        region,
        line: "homeowner",
        address: listing.address,
        listingSlug: null,
        vendorParam: null,
        listing,
      })
    : null;

  const rows = prefill ? buildFieldRows(prefill) : [];
  const knownModeledRows = rows.filter((r) => r.tag !== "You add");

  return (
    <section className="[background-image:radial-gradient(circle,rgba(255,255,255,.055)_1px,transparent_1px)] [background-size:22px_22px] bg-accent text-white">
      <div className="max-w-[1200px] mx-auto px-8 py-24 grid gap-16 lg:grid-cols-2 items-center">
        <div>
          <span className="font-mono text-xs" style={{ letterSpacing: "0.08em", color: "#7fd8cc" }}>
            The data moat
          </span>
          <h2
            className="mt-4 text-3xl sm:text-[52px] font-semibold text-balance"
            style={{ lineHeight: 1.02, letterSpacing: "-0.03em" }}
          >
            You&apos;ve done enough forms for one lifetime.
          </h2>
          <p className="mt-[22px] text-[18px] text-white/70 max-w-md" style={{ lineHeight: 1.6 }}>
            We already track the property — value, size, and year built. Your coverage profile starts{" "}
            <strong className="text-white font-semibold">{PREFILL_FIELD_COUNT} fields deep</strong>. You confirm
            what we know and add the handful of things only you can. That&apos;s it.
          </p>

          <div className="flex items-center gap-2 mt-9">
            <div className="text-center">
              <div className="font-mono text-4xl sm:text-[56px] font-semibold leading-none" style={{ color: "#7fd8cc" }}>
                ~40s
              </div>
              <div className="text-[13px] text-white/60 mt-1.5">with Property Insights</div>
            </div>
            <svg width="70" height="50" viewBox="0 0 90 60" fill="none" className="mx-1 shrink-0" aria-hidden="true">
              <path d="M6 20c26 6 44 8 70 2" stroke="rgba(255,255,255,.4)" strokeWidth="2.4" strokeLinecap="round" />
              <path
                d="M68 12l10 10-13 6"
                stroke="rgba(255,255,255,.4)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="text-center">
              <div
                className="font-mono text-2xl sm:text-[40px] font-semibold leading-none text-white/35"
                style={{ textDecoration: "line-through" }}
              >
                ~20m
              </div>
              <div className="text-[13px] text-white/45 mt-1.5">of forms elsewhere</div>
            </div>
          </div>
        </div>

        {/* Prefill showcase graphic — Found chip, property card, legend,
            matched pill — transcribed from the design's "prefill showcase
            (hybrid graphic)" markup. Note: the design does not draw an
            explicit arrow/connector between the Found chip and the property
            card — their relationship is purely spatial (the chip sits
            top-left at rotate(-5deg), the card cascades below it at
            rotate(-1deg), overlapping by design), so none is added here.
            No floating "~40s / to a profile" stat card either — that
            element belongs to the design's hero product-scene only, not
            this section (an earlier pass added one here in error). */}
        <div className="relative w-full" style={{ minHeight: "560px" }}>
          {!listing ? (
            <div className="rounded-[22px] border border-white/15 bg-white/5 p-8 text-center text-white/70 text-sm leading-relaxed">
              {kvError
                ? "We couldn't load a sample property just now — the pre-fill still works the same way once you enter your own address."
                : "We don't have a tracked listing to preview in this region yet — the pre-fill still works the same way once you enter your own address."}
            </div>
          ) : (
            <>
              <div
                className="absolute pointer-events-none"
                style={{
                  left: "50%",
                  top: "47%",
                  transform: "translate(-50%,-50%)",
                  width: "440px",
                  height: "400px",
                  background: "radial-gradient(ellipse, rgba(127,216,204,.3), transparent 66%)",
                }}
              />

              {/* Found chip */}
              <div
                className="absolute inline-flex items-center"
                style={{
                  zIndex: 3,
                  left: 0,
                  top: "-6px",
                  gap: "9px",
                  background: "#fff",
                  borderRadius: 9999,
                  padding: "10px 15px",
                  boxShadow: "0 16px 34px -12px rgba(0,0,0,.55)",
                  transform: "rotate(-5deg)",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" stroke="#9ca3af" strokeWidth="1.9" />
                  <path d="M20 20l-3.5-3.5" stroke="#9ca3af" strokeWidth="1.9" strokeLinecap="round" />
                </svg>
                <span style={{ fontSize: "13px", fontWeight: 500, color: "#1a1a2e" }}>{listing.address}</span>
                <span
                  className="inline-flex items-center font-mono uppercase"
                  style={{
                    gap: "4px",
                    fontSize: "9px",
                    letterSpacing: "0.05em",
                    color: "#0f766e",
                    background: "#e6f1ef",
                    borderRadius: 9999,
                    padding: "3px 8px",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#0f766e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Found
                </span>
              </div>

              {/* Property card centerpiece */}
              <div
                className="relative overflow-hidden"
                style={{
                  zIndex: 2,
                  margin: "46px auto 0",
                  maxWidth: "452px",
                  background: "#fff",
                  color: "#1a1a2e",
                  borderRadius: "22px",
                  boxShadow: "0 34px 80px -28px rgba(0,0,0,.7)",
                  transform: "rotate(-1deg)",
                }}
              >
                <div
                  className="flex items-center justify-between gap-3"
                  style={{ padding: "18px 22px", borderBottom: "1px solid #f0f1f3" }}
                >
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 600 }}>{listing.address}</div>
                    <div style={{ fontSize: "12.5px", color: "#6b7280" }}>
                      {listing.city}, {listing.province}
                    </div>
                  </div>
                  <span
                    className="font-mono uppercase shrink-0"
                    style={{
                      fontSize: "9px",
                      letterSpacing: "0.06em",
                      color: "#0f766e",
                      background: "#e6f1ef",
                      borderRadius: 9999,
                      padding: "3px 9px",
                    }}
                  >
                    On file
                  </span>
                </div>
                <div style={{ padding: "6px 22px 16px" }}>
                  {knownModeledRows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between gap-3"
                      style={{ padding: "9px 0", borderBottom: "1px solid #f5f6f7" }}
                    >
                      <span style={{ fontSize: "13px", color: "#6b7280" }}>{row.label}</span>
                      <span className="flex items-center" style={{ gap: "9px" }}>
                        <span className="font-mono" style={{ fontSize: "13px", fontWeight: 500 }}>
                          {row.value}
                        </span>
                        <span
                          className="font-mono uppercase whitespace-nowrap"
                          style={{
                            fontSize: "8px",
                            letterSpacing: "0.05em",
                            color: TAG_STYLE[row.tag].tagColor,
                            background: TAG_STYLE[row.tag].tagBg,
                            borderRadius: 9999,
                            padding: "2px 7px",
                          }}
                        >
                          {row.tag}
                        </span>
                      </span>
                    </div>
                  ))}
                  {/* "You add" rows always render — see buildFieldRows */}
                  {rows
                    .filter((r) => r.tag === "You add")
                    .map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between gap-3"
                        style={{ padding: "9px 0", borderBottom: "1px solid #f5f6f7" }}
                      >
                        <span style={{ fontSize: "13px", color: "#6b7280" }}>{row.label}</span>
                        <span className="flex items-center" style={{ gap: "9px" }}>
                          <span className="font-mono" style={{ fontSize: "13px", fontWeight: 500 }}>
                            {row.value}
                          </span>
                          <span
                            className="font-mono uppercase whitespace-nowrap"
                            style={{
                              fontSize: "8px",
                              letterSpacing: "0.05em",
                              color: TAG_STYLE[row.tag].tagColor,
                              background: TAG_STYLE[row.tag].tagBg,
                              borderRadius: 9999,
                              padding: "2px 7px",
                            }}
                          >
                            {row.tag}
                          </span>
                        </span>
                      </div>
                    ))}

                  <div className="flex flex-wrap" style={{ gap: "14px", marginTop: "14px", fontSize: "11px", color: "#9ca3af" }}>
                    <span className="flex items-center" style={{ gap: "5px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#0f766e" }} />
                      Known
                    </span>
                    <span className="flex items-center" style={{ gap: "5px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#c7ccd4" }} />
                      Modeled
                    </span>
                    <span className="flex items-center" style={{ gap: "5px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#e6a817" }} />
                      Confirm &middot; you add
                    </span>
                  </div>
                </div>
              </div>

              {/* Matched pill */}
              <div
                className="absolute inline-flex items-center whitespace-nowrap"
                style={{
                  zIndex: 4,
                  bottom: "2px",
                  left: "50%",
                  transform: "translateX(-50%) rotate(1.6deg)",
                  gap: "9px",
                  background: "#0f766e",
                  color: "#fff",
                  borderRadius: 9999,
                  padding: "11px 18px",
                  boxShadow: "0 16px 36px -12px rgba(15,118,110,.9)",
                }}
              >
                <span
                  className="inline-flex items-center justify-center"
                  style={{ width: "20px", height: "20px", borderRadius: 9999, background: "rgba(255,255,255,.2)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span style={{ fontSize: "14px", fontWeight: 600 }}>Matched with a licensed {region} insurance partner</span>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
