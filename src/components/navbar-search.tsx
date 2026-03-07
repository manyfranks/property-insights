"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { slugify } from "@/lib/utils";

interface SearchResult {
  address: string;
  city: string;
  price: number;
}

export default function NavbarSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const router = useRouter();

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          setResults(await res.json());
          setOpen(true);
        }
      } catch {
        // Silently fail
      }
    }, 200);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  function handleSelect(address: string) {
    setQuery("");
    setOpen(false);
    router.push(`/property/${slugify(address)}`);
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

  return (
    <div ref={containerRef} className="relative hidden sm:block">
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
        }}
        placeholder="Search an address..."
        className="w-64 px-3 py-1.5 text-sm rounded-lg border border-border bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/20 transition-all"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg overflow-hidden z-50 max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.address}
              onClick={() => handleSelect(r.address)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-border last:border-b-0"
            >
              <span className="text-sm font-medium text-foreground">{r.address}</span>
              <span className="text-xs text-muted ml-2">
                {r.city} &middot; ${r.price.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && query.length > 1 && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg p-3 z-50">
          <p className="text-xs text-muted text-center">No matching properties</p>
        </div>
      )}
    </div>
  );
}
