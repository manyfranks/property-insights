"use client";

import { useMemo, useState } from "react";
import PartnerCta from "@/components/partner-cta";
import {
  buildUserRentScenario,
  monthlyRentForGrossYield,
} from "@/lib/property-intelligence/investor-journey";

function money(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export interface CanadaRentalScreenProps {
  address: string;
  city: string;
  province: string;
  propertySlug: string;
  listPrice: number;
  beds: string;
  baths: string;
  sqft: string;
  regionalRent: {
    monthlyRent: number;
    cmaName: string;
    bedroomLabel: string;
    vintage: number;
  } | null;
}

export default function CanadaRentalScreen({
  address,
  city,
  province,
  propertySlug,
  listPrice,
  beds,
  baths,
  sqft,
  regionalRent,
}: CanadaRentalScreenProps) {
  const [monthlyRentInput, setMonthlyRentInput] = useState("");
  const monthlyRent = Number(monthlyRentInput.replace(/[^0-9.]/g, ""));
  const scenario = useMemo(
    () => buildUserRentScenario(listPrice, monthlyRent),
    [listPrice, monthlyRent]
  );
  const targets = [0.05, 0.06, 0.08, 0.12].map((annualYieldPct) => ({
    annualYieldPct,
    monthlyRent: monthlyRentForGrossYield(listPrice, annualYieldPct),
  }));

  return (
    <div data-p5-canada-rental-screen="limited">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{address}</h1>
        <p className="text-sm text-muted mt-0.5">{city}, {province}</p>
      </div>

      <section className="border border-border rounded-xl p-5 sm:p-6 mb-6 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Rental screen · Canada preview</div>
            <h2 className="text-xl font-semibold mt-1">Test a rent scenario without inventing one</h2>
          </div>
          <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">limited</span>
        </div>

        <p className="text-sm text-muted mb-5">
          Canada does not provide an address-level rent estimate in the current data bundle. Enter the monthly rent
          you are underwriting; we will calculate a scenario against the listing price and keep it separate from any
          regional benchmark.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <div className="border border-border rounded-lg p-4 bg-gray-50/50">
            <div className="text-xs uppercase tracking-widest text-muted mb-2">Listing price</div>
            <div className="font-mono text-2xl font-semibold">{money(listPrice)}</div>
            <p className="text-xs text-muted mt-2">Whole-property asking price from the active listing</p>
          </div>

          <div className="border border-border rounded-lg p-4 bg-gray-50/50">
            <label htmlFor="canada-rent-scenario" className="block text-xs uppercase tracking-widest text-muted mb-2">
              Your monthly rent scenario
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input
                id="canada-rent-scenario"
                type="text"
                inputMode="decimal"
                value={monthlyRentInput}
                onChange={(event) => setMonthlyRentInput(event.target.value.slice(0, 10))}
                placeholder="e.g. 4,500"
                className="min-w-0 w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-lg focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </div>
            <p className="text-xs text-muted mt-2">User-entered assumption · not a property fact</p>
          </div>

          <div className="border border-border rounded-lg p-4 bg-gray-50/50">
            <div className="text-xs uppercase tracking-widest text-muted mb-2">Scenario gross yield</div>
            {scenario ? (
              <>
                <div className="font-mono text-2xl font-semibold">{percent(scenario.grossYieldPct)}</div>
                <p className="text-xs text-muted mt-2">
                  {percent(scenario.rentToPriceRatio)} monthly rent-to-price · {scenario.onePercentRuleMet ? "meets" : "below"} 1% rule
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">Enter a monthly rent to calculate this scenario.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div className="border border-border rounded-lg p-4">
            <div className="text-xs uppercase tracking-widest text-muted mb-2">Regional rent context</div>
            {regionalRent ? (
              <>
                <div className="font-mono text-xl font-semibold">{money(regionalRent.monthlyRent)}/mo</div>
                <p className="text-xs text-muted mt-2">
                  CMHC {regionalRent.vintage} turnover rent · {regionalRent.cmaName} CMA · {regionalRent.bedroomLabel}
                </p>
                <p className="text-xs text-amber-800 mt-2">
                  Regional apartment benchmark only—not expected rent for this house or suite.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted">No CMHC benchmark is mapped for this city yet.</p>
                <p className="text-xs text-muted mt-2">The calculator remains usable with your own rent evidence.</p>
              </>
            )}
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="text-xs uppercase tracking-widest text-muted mb-2">Property context</div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><span className="block text-muted text-xs">Beds</span><span className="font-mono">{beds || "—"}</span></div>
              <div><span className="block text-muted text-xs">Baths</span><span className="font-mono">{baths || "—"}</span></div>
              <div><span className="block text-muted text-xs">Sqft</span><span className="font-mono">{sqft || "—"}</span></div>
            </div>
            <p className="text-xs text-muted mt-3">Use these facts when validating your rent assumption against local comparables.</p>
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden mb-5">
          <div className="px-4 py-3 bg-gray-50 text-xs uppercase tracking-widest text-muted">Monthly rent required by gross-yield target</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border">
            {targets.map((target) => (
              <div key={target.annualYieldPct} className="p-3 text-center">
                <div className="text-xs text-muted">{target.annualYieldPct === 0.12 ? "1% monthly" : `${(target.annualYieldPct * 100).toFixed(0)}% annual`}</div>
                <div className="font-mono font-semibold mt-1">{target.monthlyRent ? money(Math.round(target.monthlyRent)) : "—"}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted/80">
          Gross screening only. Financing, vacancy, maintenance, management, utilities, insurance, taxes, and other
          operating costs are not deducted. This is not a cash-flow or cap-rate projection.
        </p>
      </section>

      <PartnerCta
        country="CA"
        state={province}
        mode="investor"
        source="property-page"
        surface="result-investor"
        heading="Continue your rental analysis"
        propertySlug={propertySlug}
        city={city}
      />
    </div>
  );
}
