"use client";

/**
 * components/insurance/insurance-landing-form.tsx
 *
 * Address-first entry into the coverage-profile flow (Insurance Path
 * Stage 2) for visitors who arrive without a property assessment in
 * context. Collects the minimum the /coverage-profile URL contract needs —
 * country, region, address, line — and navigates there; all prefill,
 * jurisdiction gating, and consent stay in the wizard flow. If the address
 * matches a listing we already track, the wizard's page resolves it
 * server-side and pre-fills the rest (see app/coverage-profile/page.tsx).
 *
 * Excluded regions (e.g. QC) stay selectable on purpose: the wizard page
 * renders a visible availability notice for them rather than this form
 * silently hiding options.
 *
 * Lives under src/components/insurance/ so scripts/check-insurance-copy.ts
 * scans every user-facing string here for solicitation language.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Country, InsuranceLine } from "@/config/affiliate-vendors";

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

export default function InsuranceLandingForm({
  usStates,
}: {
  /** USPS code + name pairs, passed server-side to keep the county JSON out of the client bundle */
  usStates: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [country, setCountry] = useState<Country>("CA");
  const [region, setRegion] = useState("BC");
  const [address, setAddress] = useState("");
  const [line, setLine] = useState<InsuranceLine>("homeowner");

  const regions = country === "CA" ? CA_PROVINCES : usStates.map((s) => ({ code: s.code, name: s.name }));
  const ready = address.trim().length > 0 && region.length > 0;

  function switchCountry(next: Country) {
    setCountry(next);
    setRegion(next === "CA" ? "BC" : "TX");
  }

  function submit() {
    if (!ready) return;
    const params = new URLSearchParams({
      country,
      region,
      line,
      address: address.trim(),
    });
    router.push(`/coverage-profile?${params.toString()}`);
  }

  return (
    <div className="border border-border rounded-xl bg-white p-5 sm:p-6">
      {/* Country toggle */}
      <div className="flex items-center gap-2 mb-4">
        {(["CA", "US"] as Country[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => switchCountry(c)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              country === c
                ? "bg-foreground text-white"
                : "bg-white text-foreground border border-border hover:border-foreground/30"
            }`}
          >
            {c === "CA" ? "Canada" : "United States"}
          </button>
        ))}
      </div>

      {/* Address + region */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <label className="flex-1 block">
          <span className="block text-xs font-medium mb-1.5">Property address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. 1247 Fairfield Rd"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </label>
        <label className="block sm:w-56">
          <span className="block text-xs font-medium mb-1.5">{country === "CA" ? "Province" : "State"}</span>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
          >
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
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
