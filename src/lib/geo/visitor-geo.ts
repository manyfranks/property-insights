"use client";

/**
 * useVisitorGeo — client-side visitor geolocation for the homepage region
 * explorer. Fetches /api/geo once (Vercel's free edge geo headers), caches
 * the result in localStorage for 24h, and exposes an override setter so a
 * visitor who manually picks a country/region has that choice remembered
 * and preferred over the detected one.
 *
 * Cache shape mirrors the project's existing "timestamped localStorage
 * value with a TTL" pattern used elsewhere for lightweight client caches.
 */

import { useCallback, useEffect, useState } from "react";

export interface VisitorGeo {
  country: string | null; // "CA" | "US" | ...
  region: string | null; // ISO 3166-2 region code without country prefix, e.g. "BC" | "TX"
}

interface CacheEntry {
  value: VisitorGeo;
  ts: number;
}

const DETECTED_KEY = "pi_geo_detected";
const OVERRIDE_KEY = "pi_geo_override";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function readCache(key: string): VisitorGeo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > TTL_MS) return null;
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: VisitorGeo): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry = { value, ts: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — fine, just skip caching
  }
}

export interface UseVisitorGeoResult {
  /** Override (if the visitor manually picked one) else detected geo. Null fields until resolved. */
  geo: VisitorGeo;
  /** True until the first resolution (cache hit or network response) completes. */
  loading: boolean;
  /** True when `geo` reflects a manual choice rather than IP detection. */
  isOverride: boolean;
  /** Persist a manual region choice, preferred over detection until cleared. */
  setRegionOverride: (geo: VisitorGeo | null) => void;
}

const EMPTY_GEO: VisitorGeo = { country: null, region: null };

export function useVisitorGeo(): UseVisitorGeoResult {
  const [detected, setDetected] = useState<VisitorGeo>(EMPTY_GEO);
  const [override, setOverride] = useState<VisitorGeo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setOverride(readCache(OVERRIDE_KEY));

    const cached = readCache(DETECTED_KEY);
    if (cached) {
      setDetected(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    fetch("/api/geo")
      .then((res) => (res.ok ? (res.json() as Promise<VisitorGeo>) : null))
      .then((data) => {
        if (cancelled) return;
        const value = data ?? EMPTY_GEO;
        setDetected(value);
        writeCache(DETECTED_KEY, value);
      })
      .catch(() => {
        if (!cancelled) setDetected(EMPTY_GEO);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setRegionOverride = useCallback((geo: VisitorGeo | null) => {
    setOverride(geo);
    if (geo) {
      writeCache(OVERRIDE_KEY, geo);
    } else if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(OVERRIDE_KEY);
      } catch {
        // ignore
      }
    }
  }, []);

  return {
    geo: override ?? detected,
    loading,
    isOverride: override !== null,
    setRegionOverride,
  };
}
