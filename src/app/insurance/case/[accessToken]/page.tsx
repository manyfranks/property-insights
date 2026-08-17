import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { insuranceKernelExecution } from "@/config/insurance-kernel/execution-mode";
import { insuranceCaseAccessLimiter, insuranceCasePortalIpLimiter } from "@/lib/rate-limit";
import { dbAvailable } from "@/lib/db";
import { readCaseStatusByAccessToken, type CaseStatusView } from "@/lib/insurance/application/cases";
import { casePortalRateLimitAllowsAccess, readCaseStatusForPortal } from "@/lib/insurance/application/case-portal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Saved coverage profile status",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * `satisfies Record<CaseStatusView["status"], ...>` makes this exhaustive at
 * compile time: widening CaseStatusView["status"] without adding an entry
 * here is a type error. The runtime lookup below is still guarded — a
 * status value the type system didn't anticipate (e.g. future schema drift,
 * or a value that bypassed the type through an untyped path) must render a
 * neutral fallback, never crash the portal. See
 * docs/insurance/A1-STATUS-COPY-REVIEW.md for the approval record; the
 * SUBMISSION_IN_PROGRESS entry is a PENDING addendum, not yet approved, and
 * is unreachable in production until A2 delivery activates.
 */
const STATUS_COPY = {
  DRAFT: {
    label: "Coverage profile started",
    detail: "Your information is saved with Property Insights. It has not been sent to an insurance partner.",
  },
  COLLECTING_FACTS: {
    label: "Coverage profile in progress",
    detail: "Your information is saved with Property Insights. It has not been sent to an insurance partner.",
  },
  READY_FOR_SUBMISSION: {
    label: "Coverage profile saved",
    detail: "Your finalized profile is saved with Property Insights. It has not been sent to an insurance partner.",
  },
  SUBMISSION_IN_PROGRESS: {
    label: "Coverage profile in delivery",
    detail:
      "Your finalized profile is being delivered by Property Insights. Delivery has not yet been confirmed, and no quote, coverage, or provider decision exists yet.",
  },
} as const satisfies Record<CaseStatusView["status"], { label: string; detail: string }>;

export default async function InsuranceCaseStatusPage({
  params,
}: {
  params: Promise<{ accessToken: string }>;
}) {
  const config = insuranceKernelExecution();
  if (!config.features.casePortal) notFound();

  const { accessToken } = await params;
  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipLimiter = insuranceCasePortalIpLimiter();
  const tokenLimiter = insuranceCaseAccessLimiter();
  if (
    !await casePortalRateLimitAllowsAccess({
      ip,
      accessToken,
      ipLimiter,
      tokenLimiter,
      isProduction: process.env.NODE_ENV === "production",
    })
  ) notFound();

  const caseStatus = await readCaseStatusForPortal({
    accessToken,
    isDatabaseAvailable: dbAvailable(),
    readCaseStatus: readCaseStatusByAccessToken,
  });
  // A genuine no-match (revoked/unknown token) falls through here silently —
  // that is correct: it must be indistinguishable from an absent case and
  // must never be logged.
  if (!caseStatus) notFound();

  // Indexed as a loose record, not `STATUS_COPY[caseStatus.status]`, so a
  // status value that slips past the CaseStatusView["status"] type at
  // runtime (future schema drift) is still caught here instead of crashing
  // the page with an undefined `.label` read.
  const copy = (STATUS_COPY as Record<string, { label: string; detail: string }>)[caseStatus.status];
  if (!copy) {
    console.error(`insurance-portal: no status copy for case status "${caseStatus.status}" — rendering neutral fallback`);
    return (
      <main className="min-h-[70vh] bg-background px-6 py-16">
        <section className="mx-auto max-w-xl rounded-2xl border border-border bg-white p-6 sm:p-8">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Saved profile status</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Status temporarily unavailable</h1>
          <p className="mt-5 text-xs leading-relaxed text-muted">
            This page reports only what Property Insights has saved. It does not report a quote, coverage, or action by an insurance provider.
          </p>
        </section>
      </main>
    );
  }
  return (
    <main className="min-h-[70vh] bg-background px-6 py-16">
      <section className="mx-auto max-w-xl rounded-2xl border border-border bg-white p-6 sm:p-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted">Saved profile status</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{copy.label}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{copy.detail}</p>

        <dl className="mt-6 divide-y divide-border rounded-xl border border-border px-4">
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-xs text-muted">Profile version</dt>
            <dd className="font-mono text-xs font-medium text-foreground">
              {caseStatus.submissionVersion ?? "Not finalized"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <dt className="text-xs text-muted">Last saved</dt>
            <dd className="font-mono text-xs font-medium text-foreground">
              {new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(caseStatus.updatedAt))}
            </dd>
          </div>
        </dl>

        <p className="mt-5 text-xs leading-relaxed text-muted">
          This page reports only what Property Insights has saved. It does not report a quote, coverage, or action by an insurance provider.
        </p>
      </section>
    </main>
  );
}
