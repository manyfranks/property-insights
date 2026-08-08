"use client";

/**
 * Mini property-tax calculator for the /property-tax county page — takes a
 * home price and multiplies by the county's ACS-derived effective rate
 * (median_re_taxes_paid / median_home_value, see src/lib/db/property-tax.ts)
 * for an instant estimated annual bill. Deliberately simple (one input, one
 * multiplication) — the page's explainer prose right below this component
 * is where the "this is an estimate, not your actual bill" caveats live.
 */

import { useMemo, useState } from "react";

export default function PropertyTaxCalculator({
  countyName,
  effectiveRate,
  defaultValue,
}: {
  countyName: string;
  /** ratio, e.g. 0.011 = 1.1% */
  effectiveRate: number;
  /** pre-fills the input with the county's own median home value so the
   * calculator shows a sensible result before the visitor types anything */
  defaultValue: number;
}) {
  const [homeValue, setHomeValue] = useState(String(Math.round(defaultValue)));

  const homeValueNum = parseFloat(homeValue.replace(/[^0-9.]/g, ""));

  const estimate = useMemo(() => {
    if (!homeValueNum || homeValueNum <= 0) return null;
    return homeValueNum * effectiveRate;
  }, [homeValueNum, effectiveRate]);

  return (
    <div className="border border-border rounded-xl p-4 sm:p-6 bg-white">
      <div className="text-xs uppercase tracking-widest text-muted mb-3">
        Property Tax Calculator
      </div>
      <p className="text-sm text-foreground mb-4">
        What would property taxes be on a home in {countyName}?
      </p>

      <label htmlFor="home-value" className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
        Home value
      </label>
      <div className="relative mb-4">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
        <input
          id="home-value"
          type="text"
          inputMode="numeric"
          value={homeValue}
          onChange={(e) => setHomeValue(e.target.value)}
          placeholder="450,000"
          className="w-full pl-6 pr-3 py-2.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
        />
      </div>

      {estimate != null ? (
        <div className="pt-4 border-t border-border">
          <div className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
            Estimated annual property tax
          </div>
          <div className="font-mono text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            ${Math.round(estimate).toLocaleString()}
            <span className="text-sm text-muted font-sans">/yr</span>
          </div>
          <div className="text-xs text-muted mt-1">
            ${Math.round(estimate / 12).toLocaleString()}/mo &middot; based on {countyName}&apos;s{" "}
            {(effectiveRate * 100).toFixed(2)}% effective rate
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted">Enter a home value to see an estimate.</div>
      )}
    </div>
  );
}
