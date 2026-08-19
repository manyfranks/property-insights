"use client";

// Client-boundary wrapper around Clerk's auth-dependent nav controls.
//
// Why this file exists: `Show` (and `SignedIn`/`SignedOut`) resolve to
// different implementations depending on whether the importing module is a
// Server or Client Component (see @clerk/nextjs's "#components" conditional
// export). Rendered directly inside a Server Component — as this used to be,
// inline in src/app/layout.tsx — `Show` resolves to its server
// implementation, which calls Clerk's `auth()` to read the session cookie.
// `auth()` reads `headers()`/`cookies()` under the hood, which are Next.js
// dynamic APIs: calling them anywhere in a route's render tree opts the
// *entire* route out of static rendering / ISR for the lifetime of that
// render. Since this markup lived in the ROOT layout, it silently forced
// every single page in the app (every /us/**, /property/**, /discover/**,
// /blog/** route) to render as `ƒ (Dynamic)` on every request, regardless of
// each page's own `export const revalidate` — see docs/... cache
// investigation, 2026-08-19.
//
// Moving this into its own "use client" module makes `Show`/`SignInButton`/
// `UserButton` resolve to their client implementations instead, which read
// auth state from ClerkProvider's browser-side context (hydrated after the
// static HTML ships) rather than calling `auth()` during the server render.
// That keeps the root layout — and everything wrapped by it — statically
// prerenderable/ISR-eligible again.
import { Show, SignInButton, UserButton } from "@clerk/nextjs";

export default function AuthNav() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="px-3 py-1 text-sm rounded-full border border-foreground text-foreground hover:bg-foreground hover:text-white transition-all">
            Sign in
          </button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
