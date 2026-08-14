"use client";

/**
 * components/insurance/insurance-landing-form.tsx
 *
 * Address-first entry into the coverage-profile flow (Insurance Path
 * Stage 2) for visitors who arrive without a property assessment in
 * context. Restyled as the approved landing redesign's pill widget —
 * icon + address input + CTA all in one rounded-full control — but keeps
 * every behavior from the original: geo-seeded region, address typeahead
 * against /api/insurance/address-lookup, and a region picker. Rendered
 * twice on the page (hero + final CTA) via the `variant` prop.
 *
 * Region handling: initial country/region come from the `initialGeo` prop
 * — read once per request, server-side, from Vercel's edge geo headers
 * (see app/insurance/page.tsx) — and seed this component's state on first
 * render. The visitor can change it via the status-row region picker
 * (a dropdown of every covered region with its rollout status chip —
 * src/config/insurance-rollout.ts is the single source for that status);
 * the choice lives only in this component's local state and is never
 * persisted anywhere. Deliberately disconnected from the shared
 * `useVisitorGeo` / `pi_geo_override` system the homepage explorer uses:
 * no 24h localStorage cache (so a VPN/IP change is reflected on the very
 * next load), and no risk of a manual change here leaking into the
 * homepage's region default.
 *
 * Address handling: a typeahead against /api/insurance/address-lookup
 * (the listings we already track) lets a known property be picked
 * directly — its slug rides along as listingId so the wizard pre-fills
 * every detail we hold. Free-typed addresses still work; the wizard just
 * has less to pre-fill. Picking a suggestion snaps country/region to the
 * listing's location — property location wins over visitor location.
 *
 * Excluded regions (e.g. QC) stay selectable on purpose: the wizard page
 * renders a visible availability notice for them rather than this form
 * silently hiding options.
 *
 * Waitlist mode: when `intakeEnabled` is false, or the selected region's
 * rollout status isn't "live", clicking through no longer navigates to
 * /coverage-profile (a flow that can't actually accept the submission) —
 * it collects an email and posts to POST /api/insurance/waitlist instead.
 * Success and errors are both shown inline, never silently swallowed.
 *
 * Progressive disclosure: the design shows a single widget (the address
 * pill) — the email/"Notify me" capture row is not a second always-visible
 * UI competing with it. The first click on the pill's "Join the ... waitlist"
 * button just reveals the email row (smooth drop-in, focuses the input);
 * only a second click (or Enter in the email field) actually submits.
 *
 * Lives under src/components/insurance/ so scripts/check-insurance-copy.ts
 * scans every user-facing string here for solicitation language.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Country, InsuranceLine } from "@/config/affiliate-vendors";
import {
  CA_REGIONS,
  STATUS_LABEL,
  statusFor,
  regionName as lookupRegionName,
  type RolloutStatus,
} from "@/config/insurance-rollout";

interface AddressHit {
  address: string;
  city: string;
  region: string;
  country: Country;
  slug: string;
}

const STATUS_CHIP_CLASS: Record<RolloutStatus, string> = {
  live: "bg-cta-accent/10 text-cta-accent",
  next: "bg-amber-50 text-amber-700",
  soon: "bg-amber-50 text-amber-700",
  preview: "bg-gray-100 text-gray-600",
  unavailable: "bg-red-50 text-red-600",
};

function StatusChip({ status }: { status: RolloutStatus }) {
  return (
    <span
      className={`shrink-0 font-mono text-[9px] uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_CHIP_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function heroStatusText(status: RolloutStatus, name: string): string {
  switch (status) {
    case "live":
      return `Live in ${name}`;
    case "next":
    case "soon":
      return `Opening in ${name} soon`;
    case "preview":
      return `${name} · preview`;
    case "unavailable":
      return `${name} · not available yet`;
  }
}

export default function InsuranceLandingForm({
  usStates,
  initialGeo,
  initialLine,
  intakeEnabled,
  variant = "teal",
  anchorId,
}: {
  /** USPS code + name pairs, passed server-side to keep the county JSON out of the client bundle */
  usStates: { code: string; name: string }[];
  /** Visitor geo read server-side (per request) from Vercel's edge headers — see app/insurance/page.tsx. */
  initialGeo: { country: string | null; region: string | null };
  /** Preselected line from a coverage-tile link (`/insurance?line=X`), carried through silently to the wizard. */
  initialLine?: InsuranceLine;
  /** Whether the coverage-profile wizard can accept a submission at all — stageAtLeast("intake"), see src/config/insurance-stage.ts. */
  intakeEnabled: boolean;
  /** CTA button color — "teal" for the light hero/how-it-works context, "navy" for the teal final-CTA section. */
  variant?: "teal" | "navy";
  /** DOM id so other sections can anchor-link here (e.g. "How it works"'s CTA). */
  anchorId?: string;
}) {
  const router = useRouter();

  const [country, setCountry] = useState<Country>(() => (initialGeo.country === "US" ? "US" : "CA"));
  const [region, setRegion] = useState<string>(() => {
    if (initialGeo.country === "US") {
      const valid = initialGeo.region && usStates.some((s) => s.code === initialGeo.region);
      return valid ? (initialGeo.region as string) : "TX";
    }
    if (initialGeo.country === "CA") {
      const valid = initialGeo.region && CA_REGIONS.some((p) => p.code === initialGeo.region);
      return valid ? (initialGeo.region as string) : "BC";
    }
    return "BC";
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  const [address, setAddress] = useState("");
  const [line] = useState<InsuranceLine>(initialLine ?? "homeowner");

  // Typeahead state. `pickedHit` holds the picked tracked-listing hit;
  // `selected` (below) is the derived "still valid" view of it — null the
  // moment the address text no longer matches — computed each render
  // rather than cleared via a setState call inside the effect (avoids a
  // synchronous setState-in-effect, which cascades an extra render).
  const [suggestions, setSuggestions] = useState<AddressHit[]>([]);
  const [pickedHit, setPickedHit] = useState<AddressHit | null>(null);
  const selected = pickedHit && pickedHit.address === address.trim() ? pickedHit : null;
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  // Waitlist mode state — only exercised when waitlistMode is true (below).
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);
  // Progressive disclosure: the email/"Notify me" row stays hidden until the
  // pill's CTA is clicked once — see the module docstring.
  const [waitlistRevealed, setWaitlistRevealed] = useState(false);
  const waitlistEmailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = address.trim();

    // Routed through the same debounce timeout as the fetch below (rather
    // than clearing state synchronously in the effect body) so every state
    // update here happens inside a callback, not the effect body itself —
    // avoids a cascading-render lint violation for no real UX cost (a
    // 250ms debounce on "hide the dropdown" is imperceptible).
    debounceRef.current = setTimeout(async () => {
      if (q.length < 3 || (selected && q === selected.address)) {
        setSuggestions([]);
        setDropdownOpen(false);
        return;
      }

      const seq = ++requestSeqRef.current;
      try {
        const res = await fetch(`/api/insurance/address-lookup?q=${encodeURIComponent(q)}`);
        if (seq !== requestSeqRef.current) return; // a newer request already resolved
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
        if (seq !== requestSeqRef.current) return;
        setLookupNote("Address suggestions are unavailable right now — you can still type the full address.");
        setSuggestions([]);
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // `selected` is derived from `pickedHit`/`address` (both already deps),
    // so depending on it too would just be a roundabout way of depending on
    // the same two things it's computed from.
  }, [address, pickedHit, selected]);

  function pickSuggestion(hit: AddressHit) {
    setPickedHit(hit);
    setAddress(hit.address);
    setCountry(hit.country);
    setRegion(hit.region);
    setSuggestions([]);
    setDropdownOpen(false);
  }

  function applyRegionChange(nextCountry: Country, nextRegion: string) {
    setCountry(nextCountry);
    setRegion(nextRegion);
    setPickerOpen(false);
    setWaitlistSuccess(false);
    setWaitlistError(null);
    setWaitlistRevealed(false);
  }

  const displayName = lookupRegionName(country, region, usStates);
  const status = statusFor(country, region);
  const waitlistMode = !intakeEnabled || status !== "live";
  const ctaLabel = waitlistMode ? `Join the ${displayName} waitlist` : "Check my address";
  const ready = waitlistMode ? region.length > 0 : address.trim().length > 0 && region.length > 0;

  async function submit() {
    if (!ready) return;

    if (waitlistMode) {
      if (!waitlistEmail.trim()) {
        setWaitlistError("Enter an email to join the waitlist.");
        return;
      }
      setWaitlistSubmitting(true);
      setWaitlistError(null);
      try {
        const res = await fetch("/api/insurance/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: waitlistEmail.trim(),
            country,
            region,
            line,
            address: address.trim() || null,
          }),
        });
        const body = await res.json().catch(() => ({}) as Record<string, unknown>);
        if (!res.ok) {
          const message = typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
          setWaitlistError(message);
          setWaitlistSubmitting(false);
          return;
        }
        setWaitlistSuccess(true);
      } catch {
        setWaitlistError("Could not reach the server — check your connection and try again.");
      }
      setWaitlistSubmitting(false);
      return;
    }

    const params = new URLSearchParams({ country, region, line, address: address.trim() });
    if (selected) params.set("listingId", selected.slug);
    router.push(`/coverage-profile?${params.toString()}`);
  }

  /** Handles the pill's main CTA button/Enter key. In waitlist mode, the
   *  first activation just reveals the email row (matching the design's
   *  single-widget hero — no second always-visible capture UI) instead of
   *  immediately erroring for a missing email; the reveal also focuses the
   *  email input. A second activation (or Enter inside the email field)
   *  falls through to the real submit. */
  function handlePrimaryCta() {
    if (waitlistMode && !waitlistRevealed) {
      setWaitlistRevealed(true);
      requestAnimationFrame(() => waitlistEmailRef.current?.focus());
      return;
    }
    submit();
  }

  // "navy" is only ever used on the solid-teal final-CTA section
  // (src/components/insurance/landing/final-cta.tsx) — its surface is dark,
  // so every piece of copy/accent below the white input pill needs a
  // light-on-dark treatment instead of the hero's light-surface muted grays.
  const onDark = variant === "navy";
  const ctaButtonClass = onDark ? "bg-accent hover:bg-accent/90" : "bg-cta-accent hover:bg-cta-accent-hover";
  const mutedTextClass = onDark ? "text-white/70" : "text-muted";
  const accentTextClass = onDark ? "text-[#7fd8cc]" : "text-cta-accent";
  const dotClass = onDark ? "bg-[#7fd8cc]" : "bg-cta-accent";
  const onFileChipClass = onDark ? "text-[#7fd8cc] bg-white/15" : "text-cta-accent bg-cta-accent/10";
  const dividerClass = onDark ? "text-white/30" : "text-border";

  return (
    <div id={anchorId} className="w-full">
      {/* Address pill: icon + input + CTA, matching the approved design's chunky widget */}
      <div className="relative">
        <div className="flex items-center gap-2.5 bg-white border-[1.5px] border-border rounded-full py-1.5 pl-5 pr-1.5 shadow-[0_14px_40px_-18px_rgba(26,26,46,0.35)]">
          <span className="flex items-center text-muted shrink-0" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </span>
          <label className="flex-1 min-w-0">
            <span className="sr-only">Property address</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={() => setDropdownOpen(suggestions.length > 0)}
              onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePrimaryCta();
                if (e.key === "Escape") setDropdownOpen(false);
              }}
              placeholder="Enter your address"
              className="w-full min-w-0 border-none bg-transparent text-[15px] sm:text-base py-2.5 px-1 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={handlePrimaryCta}
            disabled={!ready || waitlistSubmitting}
            className={`shrink-0 rounded-full px-5 sm:px-6 py-3 text-sm font-semibold text-white whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${ctaButtonClass}`}
          >
            {ctaLabel}
          </button>
        </div>
        {dropdownOpen && suggestions.length > 0 && (
          <ul className="absolute z-20 left-0 right-0 mt-1.5 border border-border rounded-2xl bg-white shadow-lg overflow-hidden">
            {suggestions.map((hit) => (
              <li key={hit.slug}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(hit)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
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
        <p className={`text-xs mt-2.5 ${mutedTextClass}`}>
          <span
            className={`inline-block font-mono text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 mr-1.5 ${onFileChipClass}`}
          >
            On file
          </span>
          We track this property — its details will be pre-filled for you.
        </p>
      )}
      {lookupNote && <p className={`text-xs mt-2.5 ${mutedTextClass}`}>{lookupNote}</p>}

      {/* Status row: rollout status, no-lead-auction reassurance, region picker */}
      <div className={`flex flex-wrap items-center justify-center gap-2 mt-4 text-[13.5px] ${mutedTextClass}`}>
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${dotClass}`} aria-hidden="true" />
          {heroStatusText(status, displayName)}
        </span>
        <span className={dividerClass}>&middot;</span>
        <span>Matched only with licensed brokers</span>
        <span className={dividerClass}>&middot;</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className={`font-semibold hover:opacity-75 transition-opacity ${accentTextClass}`}
          >
            {displayName}, {country === "CA" ? "Canada" : "United States"}
          </button>
          {pickerOpen && (
            <div className="absolute z-30 top-6 left-1/2 -translate-x-1/2 sm:left-0 sm:translate-x-0 w-72 max-h-80 overflow-y-auto bg-white border border-border rounded-2xl shadow-xl p-1.5 text-left">
              <div className="px-2.5 pt-1.5 pb-1 font-mono text-[10px] uppercase tracking-wide text-muted">
                Canada
              </div>
              {CA_REGIONS.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => applyRegionChange("CA", r.code)}
                  className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    country === "CA" && region === r.code ? "bg-gray-50" : "hover:bg-gray-50"
                  }`}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13.5px] font-semibold text-foreground">{r.name}</span>
                    <span className="text-[11px] text-muted">Canada</span>
                  </span>
                  <StatusChip status={r.status} />
                </button>
              ))}
              <div className="px-2.5 pt-2 pb-1 font-mono text-[10px] uppercase tracking-wide text-muted">
                United States
              </div>
              {usStates.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => applyRegionChange("US", s.code)}
                  className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    country === "US" && region === s.code ? "bg-gray-50" : "hover:bg-gray-50"
                  }`}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13.5px] font-semibold text-foreground">{s.name}</span>
                    <span className="text-[11px] text-muted">United States</span>
                  </span>
                  <StatusChip status={statusFor("US", s.code)} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {waitlistMode && waitlistRevealed && (
        <div className="mt-4 flex flex-col items-center gap-2" style={{ animation: "drop 0.18s ease both" }}>
          {waitlistSuccess ? (
            <p className={`text-sm font-medium ${accentTextClass}`}>
              You&apos;re on the list — we&apos;ll email you the moment {displayName} opens.
            </p>
          ) : (
            <>
              <div className="flex w-full max-w-sm gap-2">
                <label className="flex-1">
                  <span className="sr-only">Email</span>
                  <input
                    ref={waitlistEmailRef}
                    type="email"
                    value={waitlistEmail}
                    onChange={(e) => setWaitlistEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                    }}
                    placeholder="you@email.com"
                    className="w-full border border-border rounded-full px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
                  />
                </label>
                <button
                  type="button"
                  onClick={submit}
                  disabled={waitlistSubmitting}
                  className={`shrink-0 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-40 ${ctaButtonClass}`}
                >
                  {waitlistSubmitting ? "Joining…" : "Notify me"}
                </button>
              </div>
              {waitlistError && (
                <p role="alert" className={`text-xs ${onDark ? "text-red-200" : "text-red-600"}`}>
                  {waitlistError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <p className={`text-xs leading-relaxed mt-4 text-center max-w-md mx-auto ${mutedTextClass}`}>
        Availability varies by {country === "CA" ? "province" : "state"}. You&apos;ll only ever be matched with a
        licensed broker — Property Insights does not sell, quote, or bind insurance.
      </p>
    </div>
  );
}
