"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser, SignInButton } from "@clerk/nextjs";
import { slugify } from "@/lib/utils";

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

export default function MobileSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();
  const { isSignedIn } = useUser();

  const detectedUrl = isZoocasaUrl(query) ? query.trim() : null;
  const otherUrl = isOtherListingUrl(query);

  // Auto-focus input when overlay opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure overlay is rendered before focusing
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Lock body scroll when overlay is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (detectedUrl || otherUrl) {
      setResults([]);
      setPlaces([]);
      setSearched(false);
      setSelectedAddress("");
      return;
    }

    if (query.length < 2) {
      setResults([]);
      setPlaces([]);
      setSearched(false);
      setSelectedAddress("");
      return;
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
      } catch {
        // Silently fail
      }
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query, detectedUrl, otherUrl]);

  function handleClose() {
    setOpen(false);
    setQuery("");
    setResults([]);
    setPlaces([]);
    setSearched(false);
    setSelectedAddress("");
  }

  function handleSelect(address: string) {
    handleClose();
    router.push(`/property/${slugify(address)}`);
  }

  function handleSelectPlace(place: PlaceSuggestion) {
    setSelectedAddress(place.address);
  }

  function handleRequestAssessment() {
    const address = detectedUrl || selectedAddress || query.trim();
    if (!address) return;
    handleClose();
    router.push(`/assess?address=${encodeURIComponent(address)}`);
  }

  const hasLocal = results.length > 0;
  const hasPlaces = places.length > 0;
  const noResults = searched && query.length > 1 && !hasLocal && !hasPlaces;

  // ---------- Overlay content for special states ----------

  function renderUrlDetected() {
    if (otherUrl) {
      return (
        <div className="px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground mb-1">
            We can&apos;t read this link directly
          </p>
          <p className="text-xs text-muted mb-2">
            Copy the <span className="font-medium text-foreground">street address</span> from the listing and paste it here instead. We&apos;ll find it and run a full assessment.
          </p>
          <p className="text-[10px] text-muted/70">
            Tip: Zoocasa listing URLs can be pasted directly.
          </p>
        </div>
      );
    }

    if (detectedUrl) {
      return (
        <div className="px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground mb-1">
            Listing detected
          </p>
          {isSignedIn ? (
            <>
              <p className="text-xs text-muted mb-4">
                We&apos;ll fetch this listing, run a full assessment with offer modeling, and email you the analysis.
              </p>
              <button
                onClick={handleRequestAssessment}
                className="px-5 py-2 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
              >
                Assess this listing
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted mb-4">
                Sign in and we&apos;ll fetch this listing, run a full assessment, and email you the results.
              </p>
              <SignInButton mode="modal">
                <button className="px-5 py-2 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
                  Sign in to request
                </button>
              </SignInButton>
            </>
          )}
        </div>
      );
    }

    return null;
  }

  function renderSelectedAddress() {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          We don&apos;t have this listing yet
        </p>
        <p className="text-xs text-muted mb-1 break-words">{selectedAddress}</p>
        {isSignedIn ? (
          <>
            <p className="text-xs text-muted mb-4">
              If it&apos;s currently for sale, we&apos;ll look it up, run a full assessment with offer modeling, and email you the analysis.
            </p>
            <button
              onClick={handleRequestAssessment}
              className="px-5 py-2 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
            >
              Assess this property
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted mb-4">
              Sign in and we&apos;ll look it up, run a full assessment with offer modeling, and email you the results.
            </p>
            <SignInButton mode="modal">
              <button className="px-5 py-2 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
                Sign in to request
              </button>
            </SignInButton>
          </>
        )}
      </div>
    );
  }

  function renderNoResults() {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          No matches found
        </p>
        {isSignedIn ? (
          <>
            <p className="text-xs text-muted mb-4">
              Try a more specific address, or submit what you have and we&apos;ll try to find and assess it.
            </p>
            <button
              onClick={handleRequestAssessment}
              className="px-5 py-2 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
            >
              Request assessment
            </button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted mb-4">
              Sign in and we&apos;ll look up any Canadian property, run a full assessment, and email you the analysis.
            </p>
            <SignInButton mode="modal">
              <button className="px-5 py-2 text-sm font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
                Sign in to request
              </button>
            </SignInButton>
          </>
        )}
      </div>
    );
  }

  function renderResults() {
    return (
      <div className="flex-1 overflow-y-auto">
        {hasLocal && (
          <>
            <div className="px-6 py-2 bg-gray-50">
              <span className="text-[10px] font-medium text-muted uppercase tracking-wide">Analyzed listings</span>
            </div>
            {results.map((r, i) => (
              <button
                key={`${r.address}-${i}`}
                onClick={() => handleSelect(r.address)}
                className="w-full text-left px-6 py-3 border-b border-border hover:bg-gray-50 transition-colors"
              >
                <div className="text-sm font-medium text-foreground">{r.address}</div>
                <div className="text-xs text-muted mt-0.5">
                  {r.city} &middot; ${r.price.toLocaleString()}
                </div>
              </button>
            ))}
          </>
        )}

        {hasPlaces && (
          <>
            <div className="px-6 py-2 bg-gray-50">
              <span className="text-[10px] font-medium text-muted uppercase tracking-wide">Other addresses</span>
            </div>
            {places.map((p) => (
              <button
                key={p.placeId}
                onClick={() => handleSelectPlace(p)}
                className="w-full text-left px-6 py-3 border-b border-border hover:bg-gray-50 transition-colors"
              >
                <div className="text-sm text-foreground">{p.address}</div>
                <div className="text-[10px] text-muted mt-0.5">Request assessment</div>
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  // ---------- Render ----------

  return (
    <div className="sm:hidden">
      {/* Trigger icon */}
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 text-foreground"
        aria-label="Search"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>

      {/* Full-screen overlay */}
      {open && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col">
          {/* Search header */}
          <div className="flex items-center gap-3 px-4 h-14 border-b border-border shrink-0">
            <button
              onClick={handleClose}
              className="p-1 text-muted hover:text-foreground transition-colors shrink-0"
              aria-label="Close search"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedAddress(""); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") handleClose();
                if (e.key === "Enter" && detectedUrl) handleRequestAssessment();
              }}
              placeholder="Search any address or paste a URL..."
              className="flex-1 text-sm bg-transparent placeholder:text-gray-400 focus:outline-none"
            />
            {query && (
              <button
                onClick={() => { setQuery(""); setSelectedAddress(""); setResults([]); setPlaces([]); setSearched(false); inputRef.current?.focus(); }}
                className="p-1 text-muted hover:text-foreground transition-colors shrink-0"
                aria-label="Clear"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="m15 9-6 6M9 9l6 6" />
                </svg>
              </button>
            )}
          </div>

          {/* Content area */}
          {(detectedUrl || otherUrl) && renderUrlDetected()}
          {!detectedUrl && !otherUrl && selectedAddress && renderSelectedAddress()}
          {!detectedUrl && !otherUrl && !selectedAddress && (hasLocal || hasPlaces) && renderResults()}
          {!detectedUrl && !otherUrl && !selectedAddress && noResults && renderNoResults()}

          {/* Empty state — no query yet */}
          {!detectedUrl && !otherUrl && !selectedAddress && !hasLocal && !hasPlaces && !noResults && (
            <div className="px-6 py-10 text-center">
              <p className="text-xs text-muted leading-relaxed">
                Type any Canadian address to look it up, or paste a Zoocasa listing URL to instantly assess a property you found online.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
