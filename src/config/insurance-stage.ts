/**
 * config/insurance-stage.ts
 *
 * Single-dial rollout control for the insurance path. Supersedes the three
 * separate booleans that governed this feature before 2026-08-14 —
 * NEXT_PUBLIC_INSURANCE_INTAKE (pre-existing), NEXT_PUBLIC_INSURANCE_LANDING
 * and NEXT_PUBLIC_INSURANCE_SWITCH (both added that day) — with one env var,
 * NEXT_PUBLIC_INSURANCE_STAGE, that says exactly how far the staged rollout
 * has gotten:
 *
 *   "off"     (default/unset) — nothing insurance-related is public.
 *   "landing" — /insurance landing page, address typeahead, and waitlist
 *               mode are public.
 *   "intake"  — landing, PLUS the /coverage-profile wizard and its
 *               submission APIs (POST /api/coverage-profile, the
 *               partner-connect handoff, the result-page insurance module).
 *   "switch"  — intake, PLUS the parked "already insured? we'll help you
 *               switch" section.
 *
 * Stages are monotonic/inclusive by design — "switch" implies "intake"
 * implies "landing" — mirroring the business's staged rollout so a single
 * Vercel env var value says exactly where the product is. Always gate
 * through stageAtLeast(); never compare insuranceStage() to a literal.
 *
 * Deliberately its own file, not folded into config/insurance-rollout.ts
 * (that module's other natural home): insurance-rollout.ts is imported by
 * client components ("use client" — e.g. insurance-landing-form.tsx), and
 * previously imported lib/db/coverage-profiles.ts's
 * isInsuranceIntakeEnabled() to implement the old "landing public" OR — a
 * module that pulls in lib/db (node:crypto, @neondatabase/serverless),
 * server-only dependencies that must never end up in a client bundle. This
 * file has zero imports, so it's safe to import from both client and server
 * code without that risk.
 */

export type InsuranceStage = "off" | "landing" | "intake" | "switch";

const STAGE_ORDER: Record<InsuranceStage, number> = {
  off: 0,
  landing: 1,
  intake: 2,
  switch: 3,
};

const VALID_STAGES: InsuranceStage[] = ["off", "landing", "intake", "switch"];

/**
 * Reads NEXT_PUBLIC_INSURANCE_STAGE. Unset (the default) is "off". An
 * unrecognized value ALSO falls back to "off" — fail safe, never wider than
 * intended — but this is a visible misconfiguration, so it's logged loudly
 * rather than swallowed.
 */
export function insuranceStage(): InsuranceStage {
  const raw = process.env.NEXT_PUBLIC_INSURANCE_STAGE;
  if (!raw) return "off";
  if ((VALID_STAGES as string[]).includes(raw)) return raw as InsuranceStage;
  console.warn(
    `[insurance-stage] Unrecognized NEXT_PUBLIC_INSURANCE_STAGE="${raw}" — expected one of ` +
      `${VALID_STAGES.join(", ")}. Falling back to "off".`
  );
  return "off";
}

/** True once the rollout has reached at least `stage` on the off < landing < intake < switch ladder. */
export function stageAtLeast(stage: InsuranceStage): boolean {
  return STAGE_ORDER[insuranceStage()] >= STAGE_ORDER[stage];
}
