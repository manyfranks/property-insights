"use client";

/**
 * components/insurance/insurance-landing-form.tsx
 *
 * Address-first entry into the coverage-profile flow (Insurance Path
 * Stage 2) for visitors who arrive without a property assessment in
 * context.
 *
 * Region handling: visitor geo (useVisitorGeo — same detection the
 * homepage explorer uses) assumes the country/region; the visitor can
 * change it via a quiet "Change" link rather than a prominent toggle, and
 * a manual choice persists as the shared geo override.
 *
 * Address handling: a typeahead against /api/insurance/address-lookup
 * (the listings we already track) lets a known property be picked
 * directly — its slug rides along as listingId so the wizard pre-fills
 * every detail we hold. Free-typed addresses still work; the wizard just
 * has less to pre-fill.
 *
 * Excluded regions (e.g. QC) stay selectable on purpose: the wizard page
 * renders a visible availability notice for them rather than this form
 * silently hiding options.
 *
 * Lives under src/components/insurance/ so scripts/check-insurance-copy.ts
 * scans every user-facing string here for solicitation language.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Country, InsuranceLine } from "@/config/affiliate-vendors";
import { useVisitorGeo } from "@/lib/geo/visitor-geo";

const CA_PROVINCES: { code: string; name: string }[] = [
  { code: "BC", name: "British Columbia" },
  { code: "AB", name: "Alberta" },
  { code: "SK", name: "Saskatchewan" },
  { code: "MB", name: "Manitoba" },
  { code: "ON", name: "Ontario" },
  { code: "QC", name: "Quebec" },
  { code: "NB", name: "New Brunswick" },
  { code: "NS", name: "Nova Scotia" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "NL", name: "Newfoundland and Labrador" },
];

const LINES: { id: InsuranceLine; label: string; detail: string }[] = [
  { id: "homeowner", label: "Homeowner", detail: "You live here" },
  { id: "landlord", label: "Landlord", detail: "Rented to tenants" },
  { id: "tenant", label: "Tenant", detail: "A unit you rent" },
  { id: "strata", label: "Strata / condo", detail: "Building master policy" },
  { id: "commercial", label: "Commercial", detail: "Mixed-use or commercial" },
];

interface AddressHit {
  address: string;
  city: string;
  region: string;
  country: Country;
  slug: string;
}

export default function InsuranceLandingForm({
  usStates,
}: {
  /** USPS code + name pairs, passed server-side to keep the county JSON out of the client bundle */
  usStates: { code: string; name: string }[];
}) {
  const router = useRouter();
  const { geo, loading: geoLoading, setRegionOverride } = useVisitorGeo();

  const [country, setCountry] = useState<Country>("CA");
  const [region, setRegion] = useState("BC");
  const [regionTouched, setRegionTouched] = useState(false);
  const [changingRegion, setChangingRegion] = useState(false);

  const [address, setAddress] = useState("");
  const [line, setLine] = useState<InsuranceLine>("homeowner");

  // Typeahead state. `selected` holds the picked tracked-listing hit; it is
  // cleared the moment the address text no longer matches it.
  const [suggestions, setSuggestions] = useState<AddressHit[]>([]);
  const [selected, setSelected] = useState<AddressHit | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt detected geo until the visitor touches the region controls.
  useEffect(() => {
    if (geoLoading || regionTouched) return;
    if (geo.country === "US") {
      setCountry("US");
      const valid = geo.region && usStates.some((s) => s.code === geo.region);
      setRegion(valid ? (geo.region as string) : "TX");
    } else if (geo.country === "CA") {
      setCountry("CA");
      const valid = geo.region && CA_PROVINCES.some((p) => p.code === geo.region);
      setRegion(valid ? (geo.region as string) : "BC");
    }
    // Any other / unknown country keeps the CA/BC default.
  }, [geo, geoLoading, regionTouched, usStates]);

  // Debounced typeahead.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = address.trim();

    if (selected && q !== selected.address) setSelected(null);
    if (q.length < 3 || (selected && q === selected.address)) {
      setSuggestions([]);
      setDropdownOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/insurance/address-lookup?q=${encodeURIComponent(q)}`);
        if (!res.ok) {
          setLookupNote("Address suggestions are unavailable right now — you can still type the full address.");
          setSuggestions([]);
          return;
        }
        setLookupNote(null);
        const body = (await res.json()) as { results?: AddressHit[] };
        setSuggestions(body.results ?? []);
        setDropdownOpen((body.results ?? []).length > 0);
      } catch {
        setLookupNote("Address suggestions are unavailable right now — you can still type the full address.");
        setSuggestions([]);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [address, selected]);

  function pickSuggestion(hit: AddressHit) {
    setSelected(hit);
    setAddress(hit.address);
    setCountry(hit.country);
    setRegion(hit.region);
    setRegionTouched(true);
    setSuggestions([]);
    setDropdownOpen(false);
  }

  function applyRegionChange(nextCountry: Country, nextRegion: string) {
    setCountry(nextCountry);
    setRegion(nextRegion);
    setRegionTouched(true);
    // Keep the shared homepage/explorer geo in sync with the manual choice.
    setRegionOverride({ country: nextCountry, region: nextRegion });
  }

  const regions = country === "CA" ? CA_PROVINCES : usStates;
  const regionName =
    (country === "CA" ? CA_PROVINCES : usStates).find((r) => r.code === region)?.name ?? region;
  const ready = address.trim().length > 0 && region.length > 0;

  function submit() {
    if (!ready) return;
    const params = new URLSearchParams({
      country,
      region,
      line,
      address: address.trim(),
    });
    if (selected) params.set("listingId", selected.slug);
    router.push(`/coverage-profile?${params.toString()}`);
  }

  return (
    <div className="border border-border rounded-xl bg-white p-5 sm:p-6">
      {/* Address with typeahead */}
      <div className="relative mb-2">
        <label className="block">
          <span className="block text-xs font-medium mb-1.5">Property address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={() => setDropdownOpen(suggestions.length > 0)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setDropdownOpen(false);
            }}
            placeholder="e.g. 1247 Fairfield Rd"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </label>
        {dropdownOpen && suggestions.length > 0 && (
          <ul className="absolute z-20 left-0 right-0 mt-1 border border-border rounded-lg bg-white shadow-sm overflow-hidden">
            {suggestions.map((hit) => (
              <li key={hit.slug}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(hit)}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                >
                  <span className="font-medium">{hit.address}</span>
                  <span className="text-muted"> — {hit.city}, {hit.region}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected && (
        <p className="text-xs text-muted mb-2">
          <span className="inline-block font-mono text-[10px] uppercase tracking-wide text-[#0f766e] bg-[#e6f1ef] rounded-full px-2 py-0.5 mr-1.5">
            On file
          </span>
          We track this property — its details will be pre-filled for you.
        </p>
      )}
      {lookupNote && <p className="text-xs text-muted mb-2">{lookupNote}</p>}

      {/* Region — assumed from geo, changed via a quiet link */}
      <div className="mb-4 text-xs text-muted">
        {!changingRegion ? (
          <>
            Region: <span className="text-foreground font-medium">{regionName}, {country === "CA" ? "Canada" : "United States"}</span>{" "}
            <button
              type="button"
              onClick={() => setChangingRegion(true)}
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Change
            </button>
          </>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <select
              value={country}
              onChange={(e) => {
                const next = e.target.value as Country;
                applyRegionChange(next, next === "CA" ? "BC" : "TX");
              }}
              className="border border-border rounded-md px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
            >
              <option value="CA">Canada</option>
              <option value="US">United States</option>
            </select>
            <select
              value={region}
              onChange={(e) => applyRegionChange(country, e.target.value)}
              className="border border-border rounded-md px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
            >
              {regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setChangingRegion(false)}
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Done
            </button>
          </span>
        )}
      </div>

      {/* Line chooser */}
      <div className="mb-5">
        <span className="block text-xs font-medium mb-1.5">What are you insuring?</span>
        <div className="flex flex-wrap gap-2">
          {LINES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLine(l.id)}
              title={l.detail}
              className={`px-3.5 py-1.5 rounded-full text-sm transition-colors ${
                line === l.id
                  ? "bg-foreground text-white"
                  : "bg-white text-foreground border border-border hover:border-foreground/30"
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!ready}
        className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-sm font-medium bg-foreground text-white hover:bg-foreground/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Build this property&apos;s coverage profile &rarr;
      </button>

      <p className="text-xs text-muted leading-relaxed mt-4">
        Availability varies by {country === "CA" ? "province" : "state"}. You&apos;ll only ever be matched with a
        licensed broker — Property Insights does not sell, quote, or bind insurance.
      </p>
    </div>
  );
}
