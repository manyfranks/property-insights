"use client";

/**
 * components/insurance/coverage-profile-wizard.tsx
 *
 * Screen 2 of the Insurance Path design: "Variation A" — a 4-step wizard
 * (confirm property → what are you insuring → occupancy → contact +
 * consent) rather than one long form. Submits to POST /api/coverage-profile
 * on the last step and, on success, swaps in the screen-4 handoff
 * (coverage-handoff.tsx) with the returned profile id — no route change,
 * this component owns both screens' transition.
 *
 * Compliance: the consent checkbox copy is verbatim per the build spec, and
 * this whole directory is scanned by scripts/check-insurance-copy.ts for
 * solicitation-adjacent terms — keep any new copy here framed as "get
 * matched with a licensed broker," never a quote or a ranking of insurers.
 *
 * Consent copy is vendor-aware, not static: step 4 resolves the same vendor
 * coverage-handoff.tsx will hand this profile off to (resolve-vendor.ts,
 * shared with that component) and renders one of two approved variants —
 * one naming the vendor + a referral-fee disclosure when a vendor resolves,
 * one with no fee sentence (no fee arrangement exists) for the mailto
 * fallback path. `line` is the only piece of that resolution that's live
 * wizard state through step 4, so the resolved vendor — and the rendered
 * copy — can change if the visitor goes back and changes it; whatever text
 * is on screen at submit time is exactly what's persisted as `consentText`,
 * by construction (both read the same derived value).
 */

import { useEffect, useMemo, useState } from "react";
import type { InsuranceLine } from "@/config/affiliate-vendors";
import type { CoverageOccupancy } from "@/lib/db/coverage-profiles";
import {
  formatMoney,
  formatSize,
  parseNumericField,
  type CoveragePrefill,
} from "@/components/insurance/coverage-prefill";
import { ProvenanceChip, type ProvenanceSource } from "@/components/insurance/coverage-provenance-chip";
import CoverageHandoff, { type HandoffRow } from "@/components/insurance/coverage-handoff";
import { resolveVendor, regionFullName } from "@/components/insurance/resolve-vendor";

/**
 * Approved copy, verbatim, with [Brokerage Name]/[Region] filled at render
 * time. The fee-disclosure sentence only appears here — the vendor actually
 * resolved to a paid affiliate/referral relationship — never in the
 * no-vendor variant below, where no fee arrangement exists.
 */
function consentTextWithVendor(vendorName: string, regionName: string): string {
  return (
    `Yes — share my property details with ${vendorName} (licensed in ${regionName}) so they can contact me ` +
    `about insurance. I understand Property Insights may earn a referral fee if I do business with them, and ` +
    `that ${vendorName} alone provides any insurance quotes, advice, or coverage.`
  );
}

/**
 * Approved copy, verbatim, for the mailto fallback path (no resolved
 * vendor). No fee sentence — this isn't a sponsored placement.
 */
const CONSENT_TEXT_WITHOUT_VENDOR =
  "Yes — share my property details with a licensed insurance brokerage for my region so they can contact me " +
  "about insurance. Any insurance quotes, advice, or coverage come from that licensed brokerage — Property " +
  "Insights does not sell, quote, or bind insurance.";

const STEP_META = [
  {
    kicker: "Step 1 of 4",
    title: "Confirm the property",
    sub: "We pulled these from your assessment. Fix anything that's off — most people don't need to.",
  },
  {
    kicker: "Step 2 of 4",
    title: "What are you insuring?",
    sub: "This picks the right coverage line and set of licensed brokers.",
  },
  {
    kicker: "Step 3 of 4",
    title: "How is it occupied?",
    sub: "Occupancy is the single biggest driver of which policy applies.",
  },
  {
    kicker: "Step 4 of 4",
    title: "Where should the broker reach you?",
    sub: "A licensed broker for your region follows up — Property Insights never sells or binds coverage.",
  },
] as const;

const LINE_OPTIONS: Array<{ id: InsuranceLine; label: string; detail: string }> = [
  { id: "homeowner", label: "Homeowner", detail: "Dwelling, contents, and liability for an owner-occupied home." },
  { id: "landlord", label: "Landlord", detail: "Building, loss of rent, and landlord liability for a rental." },
  { id: "tenant", label: "Tenant", detail: "Contents and liability coverage for a unit you don't own." },
  { id: "strata", label: "Strata / condo", detail: "The building-level master policy for a strata or condo board." },
  {
    id: "commercial",
    label: "Commercial",
    detail: "Property, liability, and business interruption for a mixed-use building.",
  },
];

const OCCUPANCY_OPTIONS: Array<{ id: CoverageOccupancy; label: string; detail: string }> = [
  { id: "owner", label: "Owner-occupied", detail: "You live here" },
  { id: "long_term_rental", label: "Long-term rental", detail: "Leased to a tenant" },
  { id: "short_term_rental", label: "Short-term rental", detail: "Airbnb / VRBO" },
  { id: "vacant", label: "Vacant / seasonal", detail: "Unoccupied part of the year" },
];

const UNIT_COUNT_OPTIONS = [
  { label: "1", value: 1 },
  { label: "2", value: 2 },
  { label: "3–4", value: 3 },
  { label: "5+", value: 5 },
];

const CLAIMS_OPTIONS = [
  { label: "None", value: 0 },
  { label: "1", value: 1 },
  { label: "2", value: 2 },
  { label: "3 or more", value: 3 },
];

// "Under 5 years" / "5–15 years" / "15–25 years" map to the bucket's
// midpoint — an honest approximation of what the user picked, not a
// fabricated precise age. "25+ / unsure" maps to null rather than guessing.
const ROOF_AGE_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: "Under 5 years", value: 3 },
  { label: "5–15 years", value: 10 },
  { label: "15–25 years", value: 20 },
  { label: "25+ / unsure", value: null },
];

type Phase = "wizard" | "submitting" | "handoff";

// Light client-side normalization only — the server validator
// (validateCoverageAnswers in src/lib/db/coverage-profiles.ts) is the source
// of truth for what counts as a valid phone number. This just strips
// characters a phone number can't contain (letters, punctuation besides
// +/-/()/space) before it's sent.
const PHONE_DISALLOWED_CHARS = /[^0-9+\-() ]/g;

function normalizePhone(value: string): string {
  return value.trim().replace(PHONE_DISALLOWED_CHARS, "");
}

function selectClass(active: boolean): string {
  return `rounded-xl border p-3.5 text-left transition-colors ${
    active ? "border-foreground bg-gray-50" : "border-border bg-white hover:border-foreground/40"
  }`;
}

function ConfirmRow({ label, value, source }: { label: string; value: string; source: ProvenanceSource }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-b-0">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="flex items-center gap-2.5">
        <span className="font-mono text-[13.5px] font-medium text-foreground text-right">{value}</span>
        <ProvenanceChip source={source} />
      </span>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block py-2.5 border-b border-border last:border-b-0">
      <span className="block text-[11px] font-medium text-muted mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-foreground mb-1.5">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border px-3 py-2.5 text-sm bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 cursor-pointer"
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function CoverageProfileWizard({ prefill }: { prefill: CoveragePrefill }) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("wizard");
  const [error, setError] = useState<string | null>(null);

  // Each step (and the handoff swap) is a full content change — without
  // this, mobile keeps whatever scroll position the previous step ended at,
  // which can land the next step's heading off-screen above the viewport.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step, phase]);

  // Step 1 — confirm/edit
  const [editing, setEditing] = useState(false);
  const [typeDraft, setTypeDraft] = useState(prefill.identity.type ?? "");
  const [yearBuiltDraft, setYearBuiltDraft] = useState(
    prefill.identity.yearBuilt !== null ? String(prefill.identity.yearBuilt) : ""
  );
  const [bedsDraft, setBedsDraft] = useState(prefill.identity.beds !== null ? String(prefill.identity.beds) : "");
  const [bathsDraft, setBathsDraft] = useState(prefill.identity.baths !== null ? String(prefill.identity.baths) : "");
  const [sqftDraft, setSqftDraft] = useState(prefill.identity.sqft !== null ? String(prefill.identity.sqft) : "");
  const [valueDraft, setValueDraft] = useState(
    prefill.value.estimatedValue !== null ? String(prefill.value.estimatedValue) : ""
  );
  const [rentDraft, setRentDraft] = useState(
    prefill.value.estimatedRent !== null ? String(prefill.value.estimatedRent) : ""
  );

  // Fields absent from the prefill render as open inputs immediately — the
  // visitor shouldn't have to find "Edit a detail" before they can supply
  // what we never had. On-file fields stay confirm rows behind the toggle.
  // Snapshot from prefill (stable per mount), not drafts, so a field the
  // user fills in doesn't jump between sections mid-edit.
  const missing = {
    type: prefill.identity.type === null,
    yearBuilt: prefill.identity.yearBuilt === null,
    beds: prefill.identity.beds === null,
    baths: prefill.identity.baths === null,
    sqft: prefill.identity.sqft === null,
    value: prefill.value.estimatedValue === null,
    rent: prefill.value.estimatedRent === null,
  };
  const missingAny = Object.values(missing).some(Boolean);
  const anyOnFile = Object.values(missing).some((m) => !m);
  const sizeOnFile = !missing.beds || !missing.baths || !missing.sqft;

  // Step 2 — coverage line
  const [line, setLine] = useState<InsuranceLine>(prefill.line);

  // Step 3 — occupancy + the rest of the six underwriting questions
  const [occupancy, setOccupancy] = useState<CoverageOccupancy | "">("");
  const [unitCount, setUnitCount] = useState<number | "">("");
  const [claims5yr, setClaims5yr] = useState<number | "">("");
  const [roofAgeChoice, setRoofAgeChoice] = useState("");

  // Step 4 — contact + consent
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [coverageExpiryMonth, setCoverageExpiryMonth] = useState("");
  const [consent, setConsent] = useState(false);

  // The same vendor coverage-handoff.tsx will resolve for this profile.
  // country/region/vendorParam are fixed for the life of the wizard (from
  // prefill); `line` is the only live piece, so this recomputes only when
  // the visitor changes step 2. Keyed to prefill.country/region/vendorParam
  // too so a change of `prefill` identity (shouldn't happen mid-mount, but
  // cheap to be correct about) doesn't leave a stale resolution.
  const resolvedVendor = useMemo(
    () => resolveVendor(prefill.country, prefill.region, line, prefill.vendorParam),
    [prefill.country, prefill.region, prefill.vendorParam, line]
  );

  // Exactly what's rendered in the step-4 checkbox label — and, by using
  // this same value at submit time below, exactly what's persisted as
  // consentText. Never diverge these into two separate strings.
  const consentText = useMemo(
    () =>
      resolvedVendor
        ? consentTextWithVendor(resolvedVendor.name, regionFullName(prefill.region))
        : CONSENT_TEXT_WITHOUT_VENDOR,
    [resolvedVendor, prefill.region]
  );

  const [submittedProfileId, setSubmittedProfileId] = useState<string | null>(null);
  const [handoffRows, setHandoffRows] = useState<HandoffRow[]>([]);

  if (phase === "handoff" && submittedProfileId) {
    return (
      <CoverageHandoff
        profileId={submittedProfileId}
        country={prefill.country}
        region={prefill.region}
        line={line}
        vendorParam={prefill.vendorParam}
        rows={handoffRows}
      />
    );
  }

  const step3Ready = occupancy !== "" && unitCount !== "" && claims5yr !== "" && roofAgeChoice !== "";
  const canContinue = step === 2 ? step3Ready : true;
  const finalStepReady = consent && email.trim() !== "" && name.trim() !== "";

  function buildHandoffRows(): HandoffRow[] {
    const lineLabel = LINE_OPTIONS.find((o) => o.id === line)?.label ?? line;
    const occupancyLabel = OCCUPANCY_OPTIONS.find((o) => o.id === occupancy)?.label ?? String(occupancy);
    const yearVal = parseNumericField(yearBuiltDraft);
    const valueVal = parseNumericField(valueDraft);

    return [
      { label: "Address", value: prefill.address, source: "known" },
      { label: "Property type", value: typeDraft.trim() || "— not on file", source: "known" },
      { label: "Year built", value: yearVal !== null ? String(yearVal) : "— not on file", source: "known" },
      {
        label: "Estimated value",
        value: valueVal !== null ? formatMoney(valueVal, prefill.country) : "— not on file",
        source: "modeled",
      },
      { label: "Coverage type", value: lineLabel, source: "you" },
      { label: "Occupancy", value: occupancyLabel, source: "you" },
      {
        label: "Claims (5 yr)",
        value: claims5yr === "" ? "— not on file" : claims5yr === 0 ? "None" : String(claims5yr),
        source: "you",
      },
      { label: "Region", value: prefill.region, source: "known" },
    ];
  }

  async function submit() {
    setError(null);

    if (!step3Ready) {
      setError("Please complete the occupancy questions before continuing.");
      setStep(2);
      return;
    }
    if (!finalStepReady) return;

    const roofAgeOption = ROOF_AGE_OPTIONS.find((o) => o.label === roofAgeChoice);
    const normalizedPhone = normalizePhone(phone) || null;

    setPhase("submitting");

    const payload = {
      country: prefill.country,
      region: prefill.region,
      address: prefill.address,
      line,
      property: {
        identity: {
          type: typeDraft.trim() || null,
          yearBuilt: parseNumericField(yearBuiltDraft),
          beds: parseNumericField(bedsDraft),
          baths: parseNumericField(bathsDraft),
          sqft: parseNumericField(sqftDraft),
          source: prefill.identity.source,
        },
        value: {
          estimatedValue: parseNumericField(valueDraft),
          estimatedRent: parseNumericField(rentDraft),
          source: prefill.value.source,
        },
        hazards: {
          flood: null,
          wildfire: null,
          wind: null,
          source: "modeled",
        },
      },
      answers: {
        occupancy,
        unitCount,
        claims5yr,
        coverageExpiry: coverageExpiryMonth ? `${coverageExpiryMonth}-01` : null,
        roofAge: roofAgeOption?.value ?? null,
        contact: {
          name: name.trim(),
          email: email.trim(),
          phone: normalizedPhone,
          // No separate UI for this — deriving it keeps step 4 to two contact
          // fields. "either" once a phone is given (the broker can use
          // whichever reaches the user faster), "email" when it's the only
          // channel supplied.
          preference: normalizedPhone ? "either" : "email",
        },
      },
      consent: true,
      consentText,
      source: "assess-result",
    };

    try {
      const res = await fetch("/api/coverage-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);

      if (!res.ok) {
        const message = typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
        setError(message);
        setPhase("wizard");
        return;
      }

      const id = typeof body.id === "string" ? body.id : null;
      if (!id) {
        setError("Coverage profile saved, but no confirmation id came back. Please try again.");
        setPhase("wizard");
        return;
      }

      setHandoffRows(buildHandoffRows());
      setSubmittedProfileId(id);
      setPhase("handoff");
    } catch {
      setError("Could not reach the server — check your connection and try again.");
      setPhase("wizard");
    }
  }

  function handleBack() {
    if (step === 0) return;
    setError(null);
    setStep((s) => s - 1);
  }

  function handleContinue() {
    if (step < 3) {
      if (!canContinue) return;
      setError(null);
      setStep((s) => s + 1);
      return;
    }
    void submit();
  }

  const nextDisabled =
    phase === "submitting" || (step < 3 ? !canContinue : !finalStepReady);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted">Coverage profile</div>
        <div className="text-[11px] font-mono text-muted/70">
          Step {step + 1} / 4
        </div>
      </div>
      <div className="h-[3px] bg-border rounded-full overflow-hidden mb-6">
        <div
          className="h-full bg-foreground rounded-full transition-all duration-300"
          style={{ width: `${((step + 1) / 4) * 100}%` }}
        />
      </div>

      <div className="min-h-[300px]">
        <div className="text-xs text-muted mb-2">{STEP_META[step].kicker}</div>
        <h1 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-foreground mb-1.5 text-wrap-balance">
          {STEP_META[step].title}
        </h1>
        <p className="text-sm text-muted mb-5 max-w-md">
          {step === 0 && missingAny
            ? "We filled in what we know and left the rest blank — add what you can, it all helps the broker."
            : STEP_META[step].sub}
        </p>

        {step === 0 && (
          <div>
            {/* On-file details: confirm rows, editable via the toggle. */}
            <div className="rounded-xl border border-border bg-white px-4 sm:px-5">
              <ConfirmRow label="Address" value={prefill.address} source="known" />
              {!editing ? (
                <>
                  {!missing.type && (
                    <ConfirmRow label="Property type" value={typeDraft.trim() || "— not on file"} source="known" />
                  )}
                  {!missing.yearBuilt && (
                    <ConfirmRow
                      label="Year built"
                      value={parseNumericField(yearBuiltDraft) !== null ? yearBuiltDraft : "— not on file"}
                      source="known"
                    />
                  )}
                  {sizeOnFile && (
                    <ConfirmRow
                      label="Size"
                      value={formatSize(
                        parseNumericField(sqftDraft),
                        parseNumericField(bedsDraft),
                        parseNumericField(bathsDraft)
                      )}
                      source="known"
                    />
                  )}
                  {!missing.value && (
                    <ConfirmRow
                      label="Estimated value"
                      value={
                        parseNumericField(valueDraft) !== null
                          ? formatMoney(parseNumericField(valueDraft), prefill.country)
                          : "— not on file"
                      }
                      source="modeled"
                    />
                  )}
                  {!missing.rent && (
                    <ConfirmRow
                      label="Estimated rent"
                      value={
                        parseNumericField(rentDraft) !== null
                          ? `${formatMoney(parseNumericField(rentDraft), prefill.country)}/mo`
                          : "— not on file"
                      }
                      source="modeled"
                    />
                  )}
                </>
              ) : (
                <>
                  {!missing.type && (
                    <EditField label="Property type" value={typeDraft} onChange={setTypeDraft} placeholder="House" />
                  )}
                  {!missing.yearBuilt && (
                    <EditField label="Year built" value={yearBuiltDraft} onChange={setYearBuiltDraft} type="number" />
                  )}
                  {!missing.beds && <EditField label="Beds" value={bedsDraft} onChange={setBedsDraft} type="number" />}
                  {!missing.baths && (
                    <EditField label="Baths" value={bathsDraft} onChange={setBathsDraft} type="number" />
                  )}
                  {!missing.sqft && (
                    <EditField label="Size (sqft)" value={sqftDraft} onChange={setSqftDraft} type="number" />
                  )}
                  {!missing.value && (
                    <EditField label="Estimated value" value={valueDraft} onChange={setValueDraft} type="number" />
                  )}
                  {!missing.rent && (
                    <EditField
                      label="Estimated rent (monthly)"
                      value={rentDraft}
                      onChange={setRentDraft}
                      type="number"
                    />
                  )}
                </>
              )}
            </div>
            {anyOnFile && (
              <button
                type="button"
                onClick={() => setEditing((e) => !e)}
                className="mt-3 text-[13px] font-medium text-foreground underline underline-offset-2"
              >
                {editing ? "Done editing" : "Edit a detail"}
              </button>
            )}

            {/* Not-on-file details: open inputs, no toggle needed. All optional. */}
            {missingAny && (
              <div className="mt-4 rounded-xl border border-border bg-white px-4 sm:px-5 py-3">
                <div className="text-xs font-medium text-foreground mb-0.5">Add what&apos;s not on file</div>
                <p className="text-xs text-muted mb-1.5">
                  Optional — anything you add here travels with your profile and saves the broker a question.
                </p>
                {missing.type && (
                  <EditField label="Property type" value={typeDraft} onChange={setTypeDraft} placeholder="House" />
                )}
                {missing.yearBuilt && (
                  <EditField label="Year built" value={yearBuiltDraft} onChange={setYearBuiltDraft} type="number" />
                )}
                {missing.beds && <EditField label="Beds" value={bedsDraft} onChange={setBedsDraft} type="number" />}
                {missing.baths && <EditField label="Baths" value={bathsDraft} onChange={setBathsDraft} type="number" />}
                {missing.sqft && (
                  <EditField label="Size (sqft)" value={sqftDraft} onChange={setSqftDraft} type="number" />
                )}
                {missing.value && (
                  <EditField label="Estimated value" value={valueDraft} onChange={setValueDraft} type="number" />
                )}
                {missing.rent && (
                  <EditField label="Estimated rent (monthly)" value={rentDraft} onChange={setRentDraft} type="number" />
                )}
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {LINE_OPTIONS.map((option) => {
              const active = line === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setLine(option.id)}
                  className={selectClass(active)}
                >
                  <span className="block text-sm font-semibold text-foreground">{option.label}</span>
                  <span className="block text-xs text-muted mt-1">{option.detail}</span>
                </button>
              );
            })}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {OCCUPANCY_OPTIONS.map((option) => {
                const active = occupancy === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setOccupancy(option.id)}
                    className={selectClass(active)}
                  >
                    <span className="block text-sm font-semibold text-foreground">{option.label}</span>
                    <span className="block text-xs text-muted mt-1">{option.detail}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <SelectField
                label="Units in the building"
                value={unitCount === "" ? "" : String(unitCount)}
                onChange={(v) => setUnitCount(v === "" ? "" : Number(v))}
                options={UNIT_COUNT_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
              />
              <SelectField
                label="Claims in the last 5 years"
                value={claims5yr === "" ? "" : String(claims5yr)}
                onChange={(v) => setClaims5yr(v === "" ? "" : Number(v))}
                options={CLAIMS_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
              />
              <SelectField
                label="Roof / systems age"
                value={roofAgeChoice}
                onChange={setRoofAgeChoice}
                options={ROOF_AGE_OPTIONS.map((o) => ({ value: o.label, label: o.label }))}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-4">
            <label className="block">
              <span className="block text-xs font-medium text-foreground mb-1.5">Full name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Rivera"
                autoComplete="name"
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-foreground mb-1.5">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                autoComplete="email"
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-foreground mb-1.5">Phone (optional)</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
                autoComplete="tel"
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-foreground mb-1.5">Current coverage expires</span>
              <input
                type="month"
                value={coverageExpiryMonth}
                onChange={(e) => setCoverageExpiryMonth(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
              <span className="block text-xs text-muted mt-1.5">Leave blank if you don&apos;t have coverage yet.</span>
            </label>
            <label className="flex items-start gap-2.5 rounded-lg border border-border bg-background px-3.5 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs text-muted leading-relaxed">{consentText}</span>
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 mt-8">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 0}
          className="min-h-11 px-5 py-2.5 text-sm font-medium rounded-lg border border-border text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted hidden sm:inline">Takes under a minute</span>
          <button
            type="button"
            onClick={handleContinue}
            disabled={nextDisabled}
            className="min-h-11 px-6 py-2.5 text-sm font-semibold rounded-lg bg-foreground text-white hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {phase === "submitting" ? "Submitting…" : step === 3 ? "Get matched" : "Continue"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
