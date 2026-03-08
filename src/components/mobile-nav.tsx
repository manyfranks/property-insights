"use client";

import { useState } from "react";
import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";

export default function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="sm:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1.5 text-foreground"
        aria-label="Toggle menu"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute top-14 left-0 right-0 bg-white border-b border-border z-50">
          <nav className="flex flex-col px-6 py-4 gap-4 text-sm text-muted">
            <Link href="/how-it-works" onClick={() => setOpen(false)} className="hover:text-foreground transition-colors">
              How it works
            </Link>
            <Link href="/dashboard" onClick={() => setOpen(false)} className="hover:text-foreground transition-colors">
              Discover
            </Link>
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="w-fit px-3 py-1 text-sm rounded-full border border-foreground text-foreground hover:bg-foreground hover:text-white transition-all">
                  Sign in
                </button>
              </SignInButton>
            </Show>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </nav>
        </div>
      )}
    </div>
  );
}
