"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser, SignInButton } from "@clerk/nextjs";
import { slugify } from "@/lib/utils";
import { signal } from "@/lib/signal";
import posthog from "posthog-js";
import { usePostHogCaptureAllowed } from "@/lib/use-posthog-consent";

interface SearchResult {
  address: string;
  city: string;
  price: number;
}

interface PlaceSuggestion {
  address: string;
  placeId: string;
}

const ZOOCASA_URL_RE = /zoocasa\.com\/[a-z][a-z0-9-]*-[a-z]{2}-real-estate\/[a-z0-9-]+/i;
const OTHER_LISTING_RE = /(?:realtor\.ca|remax\.ca|century21\.ca|royallepage\.ca|redfin\.ca|point2homes\.com|housesigma\.com)\//i;

function isZoocasaUrl(text: string): boolean {
  return ZOOCASA_URL_RE.test(text);
}

function isOtherListingUrl(text: string): boolean {
  return !isZoocasaUrl(text) && OTHER_LISTING_RE.test(text);
}

/**
 * Country-only inference from a Google Places formatted address string
 * ("123 Main St, Vancouver, BC V5K 1A1, Canada"). Deliberately only reads
 * the trailing country token — never returns or logs the address itself —
 * so the assess_address_entered spine signal below can carry geography
 * without ever carrying the raw address (house-rule: no PII/raw-address in
 * anonymous event payloads).
 */
function inferCountryFromPlacesText(address: string): "CA" | "US" | undefined {
  if (/,\s*Canada\s*$/i.test(address)) return "CA";
  if (/,\s*(?:USA|U\.S\.A\.|United States(?: of America)?)\s*$/i.test(address)) return "US";
  return undefined;
}

/**
 * Inline address search bar for the homepage hero — the primary action for
 * all visitors, on every viewport width. Same autocomplete data sources and
 * result handling as NavbarSearch / MobileSearch, just rendered inline
 * instead of absolutely-positioned or behind a full-screen overlay.
 */
export default function HomeAddressSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [selectedPlaceId, setSelectedPlaceId] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();
  const { isSignedIn } = useUser();
  // Consent gate for the posthog.capture() calls below — see
  // src/lib/use-posthog-consent.ts for the three-state policy (anonymous
  // allowed, signed-in requires analytics consent). The `signal()` calls
  // in this file are the separate anonymous-capable spine and are not
  // gated by this hook — see signal.ts's own doc comment.
  const captureAllowed = usePostHogCaptureAllowed();

  const detectedUrl = isZoocasaUrl(query) ? query.trim() : null;
  const otherUrl = isOtherListingUrl(query);

  useEffect(() => {
    if (detectedUrl || otherUrl) {
      const resetTimer = setTimeout(() => {
        setResults([]);
        setPlaces([]);
        setSearched(false);
        setSelectedAddress("");
        setSelectedPlaceId("");
        setOpen(true);
      }, 0);
      return () => clearTimeout(resetTimer);
    }

    if (query.length < 2) {
      const resetTimer = setTimeout(() => {
        setResults([]);
        setPlaces([]);
        setSearched(false);
        setSelectedAddress("");
        setSelectedPlaceId("");
        setOpen(false);
      }, 0);
      return () => clearTimeout(resetTimer);
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const [localRes, placesRes] = await Promise.all([
          fetch(`/api/search?q=${encodeURIComponent(query)}`),
          fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`),
        ]);
        if (localRes.ok) setResults(await localRes.json());
        if (placesRes.ok) setPlaces(await placesRes.json());
        setSearched(true);
        setOpen(true);
      } catch {
        // Silently fail
      }
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query, detectedUrl, otherUrl]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(address: string) {
    setQuery("");
    setOpen(false);
    setSearched(false);
    if (captureAllowed) {
      posthog.capture("address_searched", { result_type: "existing_listing" });
    }
    router.push(`/property/${slugify(address)}`);
  }

  function handleSelectPlace(place: PlaceSuggestion) {
    setSelectedAddress(place.address);
    setSelectedPlaceId(place.placeId);
  }

  function handleRequestAssessment() {
    const address = detectedUrl || selectedAddress || query.trim();
    if (!address) return;
    setQuery("");
    setOpen(false);
    if (captureAllowed) {
      posthog.capture("address_searched", { result_type: "assessment_request" });
    }
    // Anonymous-capable spine signal, top of the assessment funnel this
    // pairs against assess_completed/assess_failed (both emitted server-side
    // in /api/assess). Fired here — the single choke point every "request an
    // assessment" path in this component funnels through (detected Zoocasa
    // URL, a selected Places suggestion, or a freely typed address) — rather
    // than at handleSelectPlace, since selecting a suggestion alone doesn't
    // yet commit to requesting an assessment. Geography only: a detected
    // Zoocasa URL is always CA (Zoocasa has no US inventory), a Places
    // selection's country is read off its formatted address text, and a
    // freely typed address with neither carries no inferable country rather
    // than a guessed one.
    const enteredCountry: "CA" | "US" | undefined = detectedUrl
      ? "CA"
      : selectedAddress
        ? inferCountryFromPlacesText(selectedAddress)
        : undefined;
    signal("assess_address_entered", {
      surface: "home_search",
      matched: !!(detectedUrl || selectedPlaceId),
      ...(enteredCountry ? { country: enteredCountry } : {}),
    });
    const placeParam = selectedPlaceId ? `&placeId=${encodeURIComponent(selectedPlaceId)}` : "";
    router.push(`/assess?address=${encodeURIComponent(address)}${placeParam}`);
  }

  /**
   * Action-button / Enter-key submit — mirrors what clicking the top
   * autocomplete result would do, so the button works even if the user
   * never opens the results panel.
   */
  function handleSubmit() {
    if (!query.trim() && !detectedUrl) {
      inputRef.current?.focus();
      return;
    }
    if (detectedUrl) {
      handleRequestAssessment();
      return;
    }
    if (otherUrl) {
      setOpen(true);
      return;
    }
    if (results.length > 0) {
      handleSelect(results[0].address);
      return;
    }
    if (places.length > 0) {
      handleSelectPlace(places[0]);
      return;
    }
    handleRequestAssessment();
  }

  const hasLocal = results.length > 0;
  const hasPlaces = places.length > 0;
  const noResults = searched && query.length > 1 && !hasLocal && !hasPlaces;
  const showPanel = open && (otherUrl || detectedUrl || selectedAddress || hasLocal || hasPlaces || noResults);

  return (
    <div className="text-left">
      <div ref={containerRef} className="relative">
        <div className="flex items-center gap-1.5 w-full rounded-full border border-border bg-white pl-4 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-foreground/10 focus-within:border-foreground/20 transition-all">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedAddress("");
              setSelectedPlaceId("");
            }}
            onFocus={() => (query.length > 1 || detectedUrl || otherUrl) && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="Search any address..."
            className="flex-1 min-w-0 bg-transparent text-sm py-1.5 placeholder:text-gray-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSubmit}
            className="shrink-0 px-4 py-2 text-sm font-medium rounded-full bg-cta-accent text-white hover:bg-cta-accent-hover transition-all"
          >
            Get analysis
          </button>
        </div>

        {showPanel && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-border rounded-lg shadow-lg overflow-hidden z-50 max-h-80 overflow-y-auto">
          {otherUrl && (
            <div className="px-4 py-4 text-center">
              <p className="text-sm font-medium text-foreground mb-1">We can&apos;t read this link directly</p>
              <p className="text-xs text-muted mb-2">
                Copy the <span className="font-medium text-foreground">street address</span> from the listing and
                paste it here instead. We&apos;ll find it and run a full assessment.
              </p>
              <p className="text-[10px] text-muted/70">Tip: Zoocasa listing URLs can be pasted directly.</p>
            </div>
          )}

          {!otherUrl && detectedUrl && (
            <div className="px-4 py-4 text-center">
              <p className="text-sm font-medium text-foreground mb-1">Listing detected</p>
              {isSignedIn ? (
                <>
                  <p className="text-xs text-muted mb-3">
                    We&apos;ll fetch this listing, run a full assessment with offer modeling, and email you the analysis.
                  </p>
                  <button
                    onClick={handleRequestAssessment}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
                  >
                    Assess this listing
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted mb-3">
                    Sign in and we&apos;ll fetch this listing, run a full assessment, and email you the results.
                  </p>
                  <SignInButton mode="modal">
                    <button className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
                      Sign in to request
                    </button>
                  </SignInButton>
                </>
              )}
            </div>
          )}

          {!otherUrl && !detectedUrl && selectedAddress && (
            <div className="px-4 py-4 text-center">
              <p className="text-sm font-medium text-foreground mb-1">We don&apos;t have this listing yet</p>
              <p className="text-xs text-muted mb-1 break-words">{selectedAddress}</p>
              {isSignedIn ? (
                <>
                  <p className="text-xs text-muted mb-3">
                    If it&apos;s currently for sale, we&apos;ll look it up, run a full assessment with offer modeling, and
                    email you the analysis.
                  </p>
                  <button
                    onClick={handleRequestAssessment}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
                  >
                    Assess this property
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted mb-3">
                    Sign in and we&apos;ll look it up, run a full assessment with offer modeling, and email you the results.
                  </p>
                  <SignInButton mode="modal">
                    <button className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
                      Sign in to request
                    </button>
                  </SignInButton>
                </>
              )}
            </div>
          )}

          {!otherUrl && !detectedUrl && !selectedAddress && (hasLocal || hasPlaces) && (
            <>
              {hasLocal &&
                results.map((r, i) => (
                  <button
                    key={`${r.address}-${i}`}
                    onClick={() => handleSelect(r.address)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-border last:border-b-0"
                  >
                    <span className="text-sm font-medium text-foreground">{r.address}</span>
                    <span className="text-xs text-muted ml-2">
                      {r.city} &middot; ${r.price.toLocaleString()}
                    </span>
                  </button>
                ))}

              {hasPlaces && (
                <>
                  {hasLocal && (
                    <div className="px-4 py-1.5 bg-gray-50 border-b border-border">
                      <span className="text-[10px] font-medium text-muted uppercase tracking-wide">
                        Other addresses
                      </span>
                    </div>
                  )}
                  {places.map((p) => (
                    <button
                      key={p.placeId}
                      onClick={() => handleSelectPlace(p)}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-border last:border-b-0"
                    >
                      <span className="text-sm text-foreground">{p.address}</span>
                      <span className="text-[10px] text-muted ml-2">Request assessment</span>
                    </button>
                  ))}
                </>
              )}
            </>
          )}

          {!otherUrl && !detectedUrl && !selectedAddress && noResults && (
            <div className="px-4 py-4 text-center">
              <p className="text-sm font-medium text-foreground mb-1">No matches found</p>
              {isSignedIn ? (
                <>
                  <p className="text-xs text-muted mb-3">
                    Try a more specific address, or submit what you have and we&apos;ll try to find and assess it.
                  </p>
                  <button
                    onClick={handleRequestAssessment}
                    className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
                  >
                    Request assessment
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted mb-3">
                    Sign in and we&apos;ll look up any property, run a full assessment, and email you the analysis.
                  </p>
                  <p className="text-[10px] text-muted/70 mb-3">
                    US addresses return a county-level market estimate rather than a listing-based offer.
                  </p>
                  <SignInButton mode="modal">
                    <button className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
                      Sign in to request
                    </button>
                  </SignInButton>
                </>
              )}
            </div>
          )}
        </div>
        )}
      </div>

      <p className="text-xs text-muted text-center mt-2.5">
        Free &middot; Results in seconds &middot; 3,144 US counties + Canada
      </p>
    </div>
  );
}
