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

export default function NavbarSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();
  const { isSignedIn } = useUser();

  // Detect URL paste and immediately show assess CTA
  const detectedUrl = isZoocasaUrl(query) ? query.trim() : null;
  const otherUrl = isOtherListingUrl(query);

  useEffect(() => {
    // Skip autocomplete when a listing URL is pasted
    if (detectedUrl || otherUrl) {
      setResults([]);
      setPlaces([]);
      setSearched(false);
      setSelectedAddress("");
      setOpen(true);
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
        // Fetch our listings and Google Places in parallel
        const [localRes, placesRes] = await Promise.all([
          fetch(`/api/search?q=${encodeURIComponent(query)}`),
          fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`),
        ]);

        if (localRes.ok) {
          setResults(await localRes.json());
        }
        if (placesRes.ok) {
          setPlaces(await placesRes.json());
        }
        setSearched(true);
        setOpen(true);
      } catch {
        // Silently fail
      }
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query, detectedUrl, otherUrl]);

  function handleSelect(address: string) {
    setQuery("");
    setOpen(false);
    setSearched(false);
    router.push(`/property/${slugify(address)}`);
  }

  function handleSelectPlace(place: PlaceSuggestion) {
    setSelectedAddress(place.address);
  }

  function handleRequestAssessment() {
    const address = detectedUrl || selectedAddress || query.trim();
    if (!address) return;
    setQuery("");
    setOpen(false);
    router.push(`/assess?address=${encodeURIComponent(address)}`);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasLocal = results.length > 0;
  const hasPlaces = places.length > 0;
  const noResults = searched && query.length > 1 && !hasLocal && !hasPlaces;

  // Shared input for URL-detected states
  const urlInput = (
    <input
      type="text"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      onFocus={() => setOpen(true)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Enter" && detectedUrl) handleRequestAssessment();
      }}
      placeholder="Search any address..."
      className="w-64 px-3 py-1.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
    />
  );

  // Non-Zoocasa listing URL — guide user to paste the address instead
  if (open && otherUrl) {
    return (
      <div ref={containerRef} className="absolute left-1/2 -translate-x-1/2 hidden sm:block">
        {urlInput}
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-80 bg-white border border-border rounded-lg shadow-lg p-4 z-50">
          <div className="text-center">
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
        </div>
      </div>
    );
  }

  // Zoocasa listing URL detected — show assess CTA immediately
  if (open && detectedUrl) {
    return (
      <div ref={containerRef} className="absolute left-1/2 -translate-x-1/2 hidden sm:block">
        {urlInput}
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-80 bg-white border border-border rounded-lg shadow-lg p-4 z-50">
          {isSignedIn ? (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground mb-1">
                Listing detected
              </p>
              <p className="text-xs text-muted mb-3">
                We&apos;ll fetch this listing, run a full assessment with offer modeling, and email you the analysis.
              </p>
              <button
                onClick={handleRequestAssessment}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
              >
                Assess this listing
              </button>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground mb-1">
                Listing detected
              </p>
              <p className="text-xs text-muted mb-3">
                Sign in and we&apos;ll fetch this listing, run a full assessment, and email you the results.
              </p>
              <SignInButton mode="modal">
                <button className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
                  Sign in to request
                </button>
              </SignInButton>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Google suggestion selected — show assess CTA
  if (open && selectedAddress) {
    return (
      <div ref={containerRef} className="absolute left-1/2 -translate-x-1/2 hidden sm:block">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedAddress(""); }}
          onFocus={() => query.length > 1 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setSelectedAddress("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search an address..."
          className="w-64 px-3 py-1.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
        />
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-80 bg-white border border-border rounded-lg shadow-lg p-4 z-50">
          {isSignedIn ? (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground mb-1">
                We don&apos;t have this listing yet
              </p>
              <p className="text-xs text-muted mb-1 break-words">{selectedAddress}</p>
              <p className="text-xs text-muted mb-3">
                If it&apos;s currently for sale, we&apos;ll look it up, run a full assessment with offer modeling, and email you the analysis.
              </p>
              <button
                onClick={handleRequestAssessment}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
              >
                Assess this property
              </button>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground mb-1">
                We don&apos;t have this listing yet
              </p>
              <p className="text-xs text-muted mb-1 break-words">{selectedAddress}</p>
              <p className="text-xs text-muted mb-3">
                Sign in and we&apos;ll look it up, run a full assessment with offer modeling, and email you the results.
              </p>
              <SignInButton mode="modal">
                <button className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
                  Sign in to request
                </button>
              </SignInButton>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute left-1/2 -translate-x-1/2 hidden sm:block">
      <div className="relative group">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length > 1 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Enter" && detectedUrl) {
              e.preventDefault();
              handleRequestAssessment();
            }
          }}
          placeholder="Search any address..."
          title="Type a Canadian address or paste a Zoocasa listing URL"
          className="w-64 px-3 py-1.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
        />
        {!query && (
          <div className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 opacity-0 group-focus-within:opacity-100 transition-opacity duration-150 z-50">
            <div className="w-2 h-2 bg-gray-900 rotate-45 mx-auto -mb-1" />
            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2.5 shadow-lg leading-relaxed">
              <p className="text-gray-300"><span className="text-white font-medium">Search</span> any Canadian address to look it up.</p>
              <p className="text-gray-300 mt-1.5"><span className="text-white font-medium">Paste a Zoocasa URL</span> to instantly assess a listing you found online.</p>
            </div>
          </div>
        )}
      </div>
      {open && (hasLocal || hasPlaces) && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-80 bg-white border border-border rounded-lg shadow-lg overflow-hidden z-50 max-h-80 overflow-y-auto">
          {/* Our listings */}
          {hasLocal && results.map((r, i) => (
            <button
              key={`${r.address}-${i}`}
              onClick={() => handleSelect(r.address)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-border last:border-b-0"
            >
              <span className="text-sm font-medium text-foreground">{r.address}</span>
              <span className="text-xs text-muted ml-2">
                {r.city} &middot; ${r.price.toLocaleString()}
              </span>
            </button>
          ))}

          {/* Google Places suggestions */}
          {hasPlaces && (
            <>
              {hasLocal && (
                <div className="px-3 py-1.5 bg-gray-50 border-b border-border">
                  <span className="text-[10px] font-medium text-muted uppercase tracking-wide">Other addresses</span>
                </div>
              )}
              {places.map((p) => (
                <button
                  key={p.placeId}
                  onClick={() => handleSelectPlace(p)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-border last:border-b-0"
                >
                  <span className="text-sm text-foreground">{p.address}</span>
                  <span className="text-[10px] text-muted ml-2">Request assessment</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {noResults && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 w-80 bg-white border border-border rounded-lg shadow-lg p-4 z-50">
          {isSignedIn ? (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground mb-1">
                No matches found
              </p>
              <p className="text-xs text-muted mb-3">
                Try a more specific address, or submit what you have and we&apos;ll try to find and assess it.
              </p>
              <button
                onClick={handleRequestAssessment}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all"
              >
                Request assessment
              </button>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-sm font-medium text-foreground mb-1">
                No matches found
              </p>
              <p className="text-xs text-muted mb-3">
                Sign in and we&apos;ll look up any Canadian property, run a full assessment, and email you the analysis.
              </p>
              <SignInButton mode="modal">
                <button className="px-4 py-1.5 text-xs font-medium rounded-lg bg-foreground text-white hover:bg-foreground/90 transition-all">
                  Sign in to request
                </button>
              </SignInButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
