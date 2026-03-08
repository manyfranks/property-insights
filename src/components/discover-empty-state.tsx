"use client";

import { useUser, SignInButton } from "@clerk/nextjs";
import CityInterestForm from "./city-interest-form";
import type { CityMeta } from "@/lib/data/city-metadata";

export default function DiscoverEmptyState({
  citySlug,
  cityName,
  cities = [],
}: {
  citySlug: string;
  cityName: string;
  cities?: CityMeta[];
}) {
  const { isSignedIn, isLoaded } = useUser();

  return (
    <div className="border border-border rounded-xl p-8 text-center max-w-md mx-auto">
      <h2 className="text-base font-semibold mb-2">
        No cached listings for {cityName} yet
      </h2>
      <p className="text-sm text-muted mb-6">
        We can find motivated sellers here — sign up and we&apos;ll email you the top
        listings we discover.
      </p>

      {!isLoaded ? null : !isSignedIn ? (
        <SignInButton mode="modal">
          <button className="px-5 py-2 text-sm font-medium rounded-full bg-foreground text-white hover:bg-foreground/90 transition-all">
            Sign up to get notified
          </button>
        </SignInButton>
      ) : (
        <CityInterestForm preselectedCity={citySlug} cities={cities} />
      )}
    </div>
  );
}
