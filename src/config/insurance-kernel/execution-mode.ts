/**
 * Server-side execution guard for the future insurance kernel.
 *
 * This is intentionally separate from the public insurance-stage dial. The
 * latter controls affiliate/waitlist presentation; it MUST NOT authorize a
 * quote, bind, claim, payment, or simulator response. Do not import this
 * module from a client component and do not add a NEXT_PUBLIC equivalent.
 */

export type KernelExecutionMode = "DISABLED" | "SIMULATION" | "SANDBOX" | "PRODUCTION";
export type RequestedKernelExecutionMode = Exclude<KernelExecutionMode, "DISABLED">;

export interface KernelFeatureFlags {
  /** A0: collect an insurance profile only. */
  profileCapture: boolean;
  /** A1: dual-write a durable case and finalized submission. */
  caseRecord: boolean;
  /** A1: expose the factual, read-only capability-token status surface. */
  casePortal: boolean;
  /** A2+: submit a quote request to an approved provider. */
  quoteRequest: boolean;
  /** Future: submit a bind request. Never means that bind succeeded. */
  bindRequest: boolean;
  /** Future: submit first-notice-of-loss intake to the authorized recipient. */
  claimIntake: boolean;
}

export interface KernelExecutionConfig {
  mode: KernelExecutionMode;
  /** The supplied value is retained for audit/health diagnostics, never trusted. */
  requestedMode: string | undefined;
  /** True only when a valid mode survives runtime narrowing. */
  enabled: boolean;
  /** Simulator-generated quote/bind/claim results are permitted only here. */
  simulatorOutputsAllowed: boolean;
  features: Readonly<KernelFeatureFlags>;
  /** A machine-readable reason suitable for logs, never customer-facing copy. */
  disabledReason?: "missing-mode" | "invalid-mode" | "production-rejects-nonproduction-mode";
}

export interface KernelExecutionEnvironment {
  NODE_ENV?: string;
  /** Vercel keeps NODE_ENV=production for preview builds, so deployment tier is authoritative when present. */
  VERCEL_ENV?: string;
  INSURANCE_KERNEL_EXECUTION_MODE?: string;
  INSURANCE_KERNEL_ENABLE_PROFILE_CAPTURE?: string;
  INSURANCE_KERNEL_ENABLE_CASE_RECORD?: string;
  INSURANCE_KERNEL_ENABLE_CASE_PORTAL?: string;
  INSURANCE_KERNEL_ENABLE_QUOTE_REQUEST?: string;
  INSURANCE_KERNEL_ENABLE_BIND_REQUEST?: string;
  INSURANCE_KERNEL_ENABLE_CLAIM_INTAKE?: string;
  /** Explicit production acknowledgement; not a secret and intentionally verbose. */
  INSURANCE_KERNEL_PRODUCTION_BIND_ACK?: string;
}

const REQUESTED_MODES: readonly RequestedKernelExecutionMode[] = ["SIMULATION", "SANDBOX", "PRODUCTION"];
const PRODUCTION_BIND_ACK = "I_UNDERSTAND_BIND_IS_LIVE";

const DISABLED_FEATURES: Readonly<KernelFeatureFlags> = Object.freeze({
  profileCapture: false,
  caseRecord: false,
  casePortal: false,
  quoteRequest: false,
  bindRequest: false,
  claimIntake: false,
});

function isRequestedMode(value: string | undefined): value is RequestedKernelExecutionMode {
  return REQUESTED_MODES.some((mode) => mode === value);
}

/** Only an exact "1" enables a feature. "true", browser input, and omission do not. */
function isEnabled(value: string | undefined): boolean {
  return value === "1";
}

/**
 * Returns the highest mode a process may operate in. A non-production
 * process can exercise provider sandboxes but can never become production
 * merely because a config value says so.
 */
function isProductionDeployment(env: KernelExecutionEnvironment): boolean {
  // Vercel preview builds use NODE_ENV=production. Prefer its explicit tier;
  // an unknown non-empty tier fails closed as production rather than exposing
  // simulation on an unrecognized hosted deployment.
  if (env.VERCEL_ENV === "production") return true;
  if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") return false;
  if (env.VERCEL_ENV) return true;
  return env.NODE_ENV === "production";
}

function runtimeMaximum(env: KernelExecutionEnvironment): RequestedKernelExecutionMode {
  return isProductionDeployment(env) ? "PRODUCTION" : "SANDBOX";
}

/** Narrow a valid requested mode to the process ceiling; it can never widen it. */
export function narrowExecutionMode(
  requested: RequestedKernelExecutionMode,
  maximum: RequestedKernelExecutionMode
): RequestedKernelExecutionMode {
  const rank: Record<RequestedKernelExecutionMode, number> = {
    SIMULATION: 0,
    SANDBOX: 1,
    PRODUCTION: 2,
  };
  return rank[requested] <= rank[maximum] ? requested : maximum;
}

function disabled(
  requestedMode: string | undefined,
  disabledReason: NonNullable<KernelExecutionConfig["disabledReason"]>
): KernelExecutionConfig {
  return {
    mode: "DISABLED",
    requestedMode,
    enabled: false,
    simulatorOutputsAllowed: false,
    features: DISABLED_FEATURES,
    disabledReason,
  };
}

/**
 * Resolve the only server-authoritative kernel configuration. Invalid and
 * missing mode values disable the kernel. In a production process, a request
 * for SIMULATION or SANDBOX disables the kernel rather than silently falling
 * back to a weaker mode: an operator must make an explicit safe correction.
 */
export function resolveKernelExecution(
  env: KernelExecutionEnvironment = process.env
): KernelExecutionConfig {
  const requestedMode = env.INSURANCE_KERNEL_EXECUTION_MODE;
  if (!requestedMode) return disabled(requestedMode, "missing-mode");
  if (!isRequestedMode(requestedMode)) return disabled(requestedMode, "invalid-mode");

  const productionDeployment = isProductionDeployment(env);
  if (productionDeployment && requestedMode !== "PRODUCTION") {
    return disabled(requestedMode, "production-rejects-nonproduction-mode");
  }

  const mode = narrowExecutionMode(requestedMode, runtimeMaximum(env));
  const profileCapture = isEnabled(env.INSURANCE_KERNEL_ENABLE_PROFILE_CAPTURE);
  // Feature dependencies only narrow capability. A child flag can never
  // activate a parent feature that the operator left disabled.
  const caseRecord = profileCapture && isEnabled(env.INSURANCE_KERNEL_ENABLE_CASE_RECORD);
  const casePortal = caseRecord && isEnabled(env.INSURANCE_KERNEL_ENABLE_CASE_PORTAL);
  // A2 delivery is a child of the durable case/submission kernel. A flag by
  // itself must never create a route to a provider with no consent/case audit
  // chain, even in a future production-authorized adapter deployment.
  const quoteRequest = caseRecord && isEnabled(env.INSURANCE_KERNEL_ENABLE_QUOTE_REQUEST);
  const claimIntake = isEnabled(env.INSURANCE_KERNEL_ENABLE_CLAIM_INTAKE);
  const bindRequest =
    mode === "PRODUCTION" &&
    isEnabled(env.INSURANCE_KERNEL_ENABLE_BIND_REQUEST) &&
    env.INSURANCE_KERNEL_PRODUCTION_BIND_ACK === PRODUCTION_BIND_ACK;

  return {
    mode,
    requestedMode,
    enabled: true,
    simulatorOutputsAllowed: mode === "SIMULATION" && !productionDeployment,
    features: Object.freeze({
      profileCapture,
      caseRecord,
      casePortal,
      quoteRequest,
      claimIntake,
      bindRequest,
    }),
  };
}

/** Convenience for server routes; evaluate there, never in browser code. */
export function insuranceKernelExecution(): KernelExecutionConfig {
  return resolveKernelExecution();
}

/**
 * A narrow invariant for future route handlers. It protects against a caller
 * accidentally attempting to return simulated insurance outcomes in any mode
 * except an explicitly configured, non-production simulation process.
 */
export function assertSimulatorOutputsAllowed(config: KernelExecutionConfig): void {
  if (!config.simulatorOutputsAllowed) {
    throw new Error("insurance-kernel: simulator output is disabled by server execution configuration");
  }
}
