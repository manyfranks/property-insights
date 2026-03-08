"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";

/**
 * Consent banner shown to signed-in users who haven't set consent preferences.
 * Appears as a bottom sheet. Once accepted, stored in Clerk unsafeMetadata.
 */
export default function ConsentBanner() {
  const { isSignedIn, user, isLoaded } = useUser();
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;
    const consent = (user.unsafeMetadata as Record<string, unknown>)?.consent;
    if (!consent) {
      // Small delay so it doesn't flash immediately on page load
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [isLoaded, isSignedIn, user]);

  async function handleAccept(partnerSharing: boolean) {
    setSaving(true);
    try {
      await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analytics: true, partnerSharing }),
      });
      // Update Clerk's local cache
      await user?.reload();
    } catch {
      // Fail silently, banner will show again next visit
    }
    setVisible(false);
    setSaving(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-white shadow-lg">
      <div className="max-w-3xl mx-auto px-6 py-5">
        <h3 className="text-sm font-medium text-foreground mb-1.5">
          Your data, your choice
        </h3>
        <p className="text-xs text-muted leading-relaxed mb-4">
          We track which properties you view and search for to improve our recommendations.
          You can also opt in to be connected with mortgage brokers and real estate
          professionals who can help with your purchase. Read our{" "}
          <Link href="/privacy" className="underline hover:text-foreground">
            privacy policy
          </Link>{" "}
          and{" "}
          <Link href="/data-usage" className="underline hover:text-foreground">
            data usage policy
          </Link>{" "}
          for details.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => handleAccept(true)}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 transition-all disabled:opacity-50"
          >
            Accept all
          </button>
          <button
            onClick={() => handleAccept(false)}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-medium rounded-full border border-border text-foreground hover:bg-gray-50 transition-all disabled:opacity-50"
          >
            Analytics only
          </button>
          <span className="text-xs text-muted">
            You can change this anytime in your account settings.
          </span>
        </div>
      </div>
    </div>
  );
}
