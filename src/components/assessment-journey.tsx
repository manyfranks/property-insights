"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PropertyCapabilities } from "@/lib/property-intelligence/capabilities";
import {
  ASSESSMENT_GOALS,
  confirmAssessmentSubject,
  hasSubjectEvidenceGap,
  journeyCapabilityStatus,
  type AssessmentGoal,
  type AssessmentSubjectChoice,
  type JourneyEventType,
} from "@/lib/property-intelligence/journey";
import type { AssessmentSubject, SubjectScope } from "@/lib/property-intelligence/subject";

const GOAL_LABELS: Record<AssessmentGoal, { label: string; detail: string }> = {
  buy_home: {
    label: "Buying a home",
    detail: "Offer, valuation, and market context",
  },
  rental_investment: {
    label: "Rental investment",
    detail: "Rent evidence and yield screening",
  },
  own_manage: {
    label: "I own or manage it",
    detail: "Value, rent, and property context",
  },
  explore: {
    label: "Explore everything",
    detail: "Show every supported insight",
  },
};

const SUBJECT_CHOICES: Array<{
  value: AssessmentSubjectChoice;
  label: string;
  detail: string;
}> = [
  {
    value: "specific_unit",
    label: "A specific unit",
    detail: "An apartment, condo, suite, or commercial unit",
  },
  {
    value: "whole_property",
    label: "The entire building or property",
    detail: "The whole structure and parcel—not one unit",
  },
  {
    value: "listing",
    label: "A listing I found",
    detail: "Use the active listing as the assessment subject",
  },
  {
    value: "explore_address",
    label: "I am exploring the address",
    detail: "Keep uncertain property-level claims withheld",
  },
];

type JourneyEventData = Record<string, string | number | boolean>;

function trackJourneyEvent(type: JourneyEventType, data: JourneyEventData): void {
  void fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, data }),
    keepalive: true,
  }).catch(() => {});
}

export function AssessmentGoalPreflight({
  address,
  initialGoal,
  onStart,
}: {
  address: string;
  initialGoal: AssessmentGoal | null;
  onStart: (goal: AssessmentGoal | null) => void;
}) {
  const [selected, setSelected] = useState<AssessmentGoal | null>(initialGoal);

  function start(goal: AssessmentGoal | null) {
    if (goal) {
      trackJourneyEvent("journey_selected", {
        goal,
        surface: "assess_preflight",
        selectionSource: "explicit",
      });
    }
    onStart(goal);
  }

  return (
    <main className="max-w-2xl mx-auto px-6 py-12 sm:py-20" data-p4-journey-preflight="true">
      <div className="text-center mb-8">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">Property assessment</div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
          What are you trying to decide?
        </h1>
        <p className="text-sm text-muted max-w-lg mx-auto">
          This sets the focus for this assessment only. You can change it on the result, and property records will
          never switch it for you.
        </p>
        <p className="text-xs text-muted/80 break-words mt-3">{address}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {ASSESSMENT_GOALS.map((goal) => {
          const option = GOAL_LABELS[goal];
          const active = selected === goal;
          return (
            <button
              key={goal}
              type="button"
              aria-pressed={active}
              onClick={() => setSelected(goal)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                active
                  ? "border-foreground bg-foreground text-white"
                  : "border-border bg-white text-foreground hover:border-foreground/40"
              }`}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className={`block text-xs mt-1 ${active ? "text-white/70" : "text-muted"}`}>
                {option.detail}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
        <button
          type="button"
          disabled={!selected}
          onClick={() => start(selected)}
          className="px-6 py-2.5 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          Start assessment
        </button>
        <button
          type="button"
          onClick={() => start(null)}
          className="px-6 py-2.5 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-gray-50 transition-all"
        >
          Skip for now
        </button>
      </div>
      <p className="text-xs text-muted text-center mt-5">Current buyer analysis remains the default when skipped.</p>
    </main>
  );
}

export function AssessmentSubjectClarification({
  subject,
  country,
  onConfirm,
}: {
  subject: AssessmentSubject;
  country: "US" | "CA";
  onConfirm: (subject: AssessmentSubject) => void;
}) {
  const [choice, setChoice] = useState<AssessmentSubjectChoice | null>(null);
  const [unit, setUnit] = useState(subject.unit ?? "");
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    trackJourneyEvent("assessment_subject_clarification_shown", {
      country,
      surface: "assess_on_demand",
      subjectScope: subject.scope,
      reason: subject.clarificationReason ?? "unspecified",
    });
  }, [country, subject.clarificationReason, subject.scope]);

  const unitRequired = choice === "specific_unit" && !unit.trim();

  function confirm() {
    if (!choice || unitRequired) return;
    const confirmed = confirmAssessmentSubject(subject, choice, unit);
    trackJourneyEvent("assessment_subject_selected", {
      country,
      surface: "assess_on_demand",
      subjectScope: confirmed.scope,
      selection: choice,
    });
    onConfirm(confirmed);
  }

  return (
    <main className="max-w-2xl mx-auto px-6 py-12 sm:py-20" data-p4-subject-clarification="true">
      <div className="text-center mb-8">
        <div className="text-xs uppercase tracking-widest text-muted mb-3">One detail before your result</div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
          What are you evaluating at this address?
        </h1>
        <p className="text-sm text-muted break-words">{subject.canonicalAddress}</p>
        <p className="text-xs text-muted mt-2 max-w-lg mx-auto">
          A unit, listing, and whole building can share an address but require different evidence. We will not choose
          one from the property class alone.
        </p>
      </div>

      <div className="space-y-3 mb-5">
        {SUBJECT_CHOICES.map((option) => {
          const active = choice === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => setChoice(option.value)}
              className={`w-full rounded-xl border p-4 text-left transition-colors ${
                active ? "border-foreground bg-gray-50" : "border-border bg-white hover:border-foreground/40"
              }`}
            >
              <span className="block text-sm font-semibold text-foreground">{option.label}</span>
              <span className="block text-xs text-muted mt-1">{option.detail}</span>
            </button>
          );
        })}
      </div>

      {choice === "specific_unit" && (
        <label className="block mb-5">
          <span className="block text-xs font-medium text-foreground mb-1.5">Unit, suite, or apartment number</span>
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value.slice(0, 32))}
            placeholder="e.g. 402"
            autoComplete="off"
            className="w-full rounded-lg border border-border px-3 py-2.5 text-sm text-foreground bg-white focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
          <span className="block text-xs text-muted mt-1.5">
            We need the unit identifier before making unit-level claims.
          </span>
        </label>
      )}

      <button
        type="button"
        disabled={!choice || unitRequired}
        onClick={confirm}
        className="w-full px-6 py-2.5 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        Continue to result
      </button>
    </main>
  );
}

export function AssessmentJourneyPanel({
  enabled = true,
  initialGoal,
  country,
  subjectScope,
  capabilities,
  onGoalChange,
  gateUnsupported = false,
  children,
}: {
  enabled?: boolean;
  initialGoal: AssessmentGoal | null;
  country: "US" | "CA";
  subjectScope: SubjectScope;
  capabilities?: PropertyCapabilities | null;
  onGoalChange?: (goal: AssessmentGoal) => void;
  gateUnsupported?: boolean;
  children?: ReactNode;
}) {
  const [goal, setGoal] = useState<AssessmentGoal>(initialGoal ?? "buy_home");
  const viewed = useRef(false);
  const status = journeyCapabilityStatus(goal, capabilities);
  const subjectEvidenceGap = hasSubjectEvidenceGap(subjectScope, capabilities);
  const effectiveStatus = subjectEvidenceGap
    ? {
        availability: "unavailable" as const,
        message: "The fetched property evidence was not resolved to the subject you confirmed, so the report remains withheld.",
      }
    : status;

  useEffect(() => {
    if (!enabled || viewed.current) return;
    viewed.current = true;
    trackJourneyEvent("journey_result_viewed", {
      country,
      surface: "assess_on_demand",
      goal,
      subjectScope,
      capabilityStatus: effectiveStatus.availability,
    });
  }, [country, effectiveStatus.availability, enabled, goal, subjectScope]);

  function switchGoal(nextGoal: AssessmentGoal) {
    if (nextGoal === goal) return;
    const previousGoal = goal;
    const nextStatus = journeyCapabilityStatus(nextGoal, capabilities);
    const nextAvailability = subjectEvidenceGap ? "unavailable" : nextStatus.availability;
    setGoal(nextGoal);
    onGoalChange?.(nextGoal);
    trackJourneyEvent("journey_switched", {
      country,
      surface: "assess_on_demand",
      previousGoal,
      goal: nextGoal,
      subjectScope,
      capabilityStatus: nextAvailability,
    });
    const params = new URLSearchParams(window.location.search);
    params.set("assessmentGoal", nextGoal);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  const badgeClass = effectiveStatus.availability === "supported"
    ? "bg-emerald-100 text-emerald-700"
    : effectiveStatus.availability === "limited"
      ? "bg-amber-100 text-amber-700"
      : "bg-zinc-100 text-zinc-600";

  if (!enabled) return <>{children}</>;

  return (
    <>
      <section
        className="border border-border rounded-xl p-4 sm:p-5 bg-white mb-6"
        data-p4-journey-panel="true"
        data-p4-selected-goal={goal}
        data-p4-goal-capability={effectiveStatus.availability}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted">Assessment focus · Preview</div>
            <p className="text-xs text-muted mt-1">Your selection changes the view state, never the property facts.</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${badgeClass}`}>{effectiveStatus.availability}</span>
        </div>

        <div className="flex flex-wrap gap-2 mb-3" aria-label="Assessment focus">
          {ASSESSMENT_GOALS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={goal === option}
              onClick={() => switchGoal(option)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                goal === option
                  ? "border-foreground bg-foreground text-white"
                  : "border-border bg-white text-foreground hover:border-foreground/40"
              }`}
            >
              {GOAL_LABELS[option].label}
            </button>
          ))}
        </div>

        <p className="text-sm text-foreground">{effectiveStatus.message}</p>
        <p className="text-xs text-muted mt-2">
          {gateUnsupported
            ? "Unsupported report modules and partner links are withheld; supported views keep the current report unchanged."
            : "The current report modules and partner links are unchanged during this preview."}
        </p>
      </section>
      {gateUnsupported && effectiveStatus.availability === "unavailable" ? (
        <section className="border border-amber-200 bg-amber-50 rounded-xl p-5 mb-6" data-p4-capability-gate="true">
          <div className="text-xs uppercase tracking-widest text-amber-700 mb-2">Report withheld for this focus</div>
          <h2 className="text-lg font-semibold text-amber-950 mb-2">
            We cannot safely apply this report to the selected subject.
          </h2>
          <p className="text-sm text-amber-900">{effectiveStatus.message}</p>
          <p className="text-xs text-amber-800 mt-2">
            {subjectEvidenceGap
              ? "Start a new assessment with the exact unit or listing identifier when you want unit-specific evidence."
              : "Choose another focus above to inspect evidence it supports."} We will not reuse building, parcel, or
            listing values as though they describe a different unit.
          </p>
        </section>
      ) : children}
    </>
  );
}
