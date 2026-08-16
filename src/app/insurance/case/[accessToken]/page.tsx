import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { insuranceKernelExecution } from "@/config/insurance-kernel/execution-mode";
import { insuranceCaseAccessLimiter, insuranceCasePortalIpLimiter } from "@/lib/rate-limit";
import { dbAvailable } from "@/lib/db";
import { readCaseStatusByAccessToken } from "@/lib/insurance/application/cases";
import { sha256 } from "@/lib/insurance/domain/submission";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Saved coverage profile status",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

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
} as const;

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
  if ((!ipLimiter || !tokenLimiter) && process.env.NODE_ENV === "production") {
    console.error("insurance-portal: rate limiter unavailable — failing closed");
    notFound();
  }
  // Per-IP limiter first and keyed on IP alone (no token material), so an
  // attacker guessing many distinct tokens from one IP still shares a single
  // budget instead of getting a fresh bucket per guess.
  if (ipLimiter) {
    const result = await ipLimiter.limit(ip);
    if (!result.success) notFound();
  }
  if (tokenLimiter) {
    const result = await tokenLimiter.limit(`${ip}:${sha256(accessToken).slice(0, 16)}`);
    if (!result.success) notFound();
  }

  if (!dbAvailable()) {
    console.error("insurance-portal: database unavailable — failing closed");
    notFound();
  }

  let caseStatus;
  try {
    caseStatus = await readCaseStatusByAccessToken(accessToken);
  } catch (error) {
    console.error("insurance-portal: case lookup failed — failing closed", error);
    notFound();
  }
  // A genuine no-match (revoked/unknown token) falls through here silently —
  // that is correct: it must be indistinguishable from an absent case and
  // must never be logged.
  if (!caseStatus) notFound();

  const copy = STATUS_COPY[caseStatus.status];
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
