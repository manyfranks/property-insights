"use client";

import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import PageViewSignal from "@/components/page-view-signal";
import { isSensitiveInsuranceCapabilityPath } from "@/lib/insurance/privacy/sensitive-routes";

/** Keeps capability-token pages out of every client analytics product. */
export default function PrivacyTelemetry() {
  const pathname = usePathname() || "";
  if (isSensitiveInsuranceCapabilityPath(pathname)) return null;

  return (
    <>
      <PageViewSignal />
      <Analytics beforeSend={(event) => {
        try {
          return isSensitiveInsuranceCapabilityPath(new URL(event.url, window.location.origin).pathname) ? null : event;
        } catch {
          return null;
        }
      }} />
      <SpeedInsights beforeSend={(event) => {
        try {
          return isSensitiveInsuranceCapabilityPath(new URL(event.url, window.location.origin).pathname) ? null : event;
        } catch {
          return null;
        }
      }} />
    </>
  );
}
