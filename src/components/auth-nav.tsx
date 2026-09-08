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
import { useSyncExternalStore } from "react";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";

const signInClassName =
  "px-3 py-1 text-sm rounded-full border border-foreground text-foreground hover:bg-foreground hover:text-white transition-all";

// Hydration guard: returns false on the server and during hydration, then true
// once the client has taken over. `useSyncExternalStore` renders the server
// snapshot while hydrating so the two always agree, then re-renders with the
// client snapshot — no `setState`-in-effect and no manual mount flag.
const subscribe = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

export default function AuthNav() {
  // Guard against React #418 (server/client hydration text mismatch).
  //
  // This component lives in the ROOT layout, so its markup ships inside every
  // page's cached HTML. Those pages are ISR-prerendered with no session, so
  // `Show`/`UserButton` render the signed-OUT branch into the cached HTML.
  // A signed-IN visitor then hydrates ClerkProvider from their browser session
  // and `Show` swaps to the signed-in branch — different text over the same
  // DOM, which is exactly the mismatch React reports as #418.
  //
  // Rendering nothing auth-dependent until hydration finishes makes the server
  // output and the first client render identical regardless of session, so
  // hydration can never disagree. Clerk's controls take over on the following
  // client re-render, which React does not diff against the cached HTML.
  const hydrated = useHydrated();

  // Pre-hydration placeholder. A plain link to the sign-in page (the same
  // target the Clerk-free fallback header uses) keeps the header stable for the
  // anonymous majority and stays usable before clerk-js hydrates.
  if (!hydrated) {
    return (
      <a href={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/"} className={signInClassName}>
        Sign in
      </a>
    );
  }

  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className={signInClassName}>Sign in</button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
