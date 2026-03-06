"use client";

import { useUser, SignInButton } from "@clerk/nextjs";
import CityInterestForm from "./city-interest-form";

export default function HomeCta() {
  const { isSignedIn, user, isLoaded } = useUser();

  if (!isLoaded) return null;

  const subscribed = (user?.unsafeMetadata?.subscribedCities as string[] | undefined) || [];

  if (!isSignedIn) {
    return (
      <div className="border border-border rounded-xl p-6 bg-white">
        <h3 className="text-sm font-semibold mb-1">Stay ahead of the market</h3>
        <p className="text-xs text-muted mb-4">
          Get notified when motivated sellers appear in your target cities.
        </p>
        <SignInButton mode="modal">
          <button className="px-5 py-2 text-sm font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 transition-all">
            Sign up free
          </button>
        </SignInButton>
      </div>
    );
  }

  if (subscribed.length > 0) {
    return (
      <div className="border border-border rounded-xl p-6 bg-white">
        <p className="text-sm text-muted">
          You&apos;re watching:{" "}
          <span className="font-medium text-foreground">{subscribed.join(", ")}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-xl p-6 bg-white">
      <h3 className="text-sm font-semibold mb-1">Get city alerts</h3>
      <p className="text-xs text-muted mb-4">
        Pick your cities and we&apos;ll email you the top motivated listings.
      </p>
      <CityInterestForm />
    </div>
  );
}
