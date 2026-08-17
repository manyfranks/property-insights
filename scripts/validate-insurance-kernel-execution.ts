import {
  assertSimulatorOutputsAllowed,
  narrowExecutionMode,
  resolveKernelExecution,
  type KernelExecutionEnvironment,
} from "../src/config/insurance-kernel/execution-mode";

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[insurance-kernel-validation] ${message}`);
}

function config(env: KernelExecutionEnvironment) {
  return resolveKernelExecution(env);
}

// Missing and malformed configuration must have no capability by default.
for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", INSURANCE_KERNEL_EXECUTION_MODE: "LIVE" }]) {
  const actual = config(env);
  expect(actual.mode === "DISABLED" && !actual.enabled, "missing/invalid execution mode must disable kernel");
  expect(!actual.simulatorOutputsAllowed, "disabled kernel must not permit simulator outputs");
}

// A production server must fail closed instead of accepting a simulation flag.
for (const requested of ["SIMULATION", "SANDBOX"]) {
  const actual = config({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    INSURANCE_KERNEL_EXECUTION_MODE: requested,
    INSURANCE_KERNEL_ENABLE_PROFILE_CAPTURE: "1",
    INSURANCE_KERNEL_ENABLE_CASE_RECORD: "1",
    INSURANCE_KERNEL_ENABLE_CASE_PORTAL: "1",
    INSURANCE_KERNEL_ENABLE_QUOTE_REQUEST: "1",
    INSURANCE_KERNEL_ENABLE_BIND_REQUEST: "1",
    INSURANCE_KERNEL_ENABLE_CLAIM_INTAKE: "1",
  });
  expect(actual.mode === "DISABLED", `production must reject ${requested}`);
  expect(!Object.values(actual.features).some(Boolean), "rejected production mode must disable every feature");
}

const simulation = config({
  // Vercel previews set NODE_ENV=production, so this must still be safe to
  // run when the explicit deployment tier says preview.
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  INSURANCE_KERNEL_EXECUTION_MODE: "SIMULATION",
  INSURANCE_KERNEL_ENABLE_PROFILE_CAPTURE: "1",
  INSURANCE_KERNEL_ENABLE_CASE_RECORD: "1",
  INSURANCE_KERNEL_ENABLE_CASE_PORTAL: "1",
  INSURANCE_KERNEL_ENABLE_QUOTE_REQUEST: "1",
  INSURANCE_KERNEL_ENABLE_CLAIM_INTAKE: "1",
});
expect(simulation.mode === "SIMULATION" && simulation.simulatorOutputsAllowed, "preview simulation should be explicit");
expect(!simulation.features.bindRequest, "simulation must never authorize a bind request");
expect(simulation.features.caseRecord && simulation.features.casePortal, "A1 child flags require their parent");
assertSimulatorOutputsAllowed(simulation);

const previewProductionRequest = config({
  NODE_ENV: "production",
  VERCEL_ENV: "preview",
  INSURANCE_KERNEL_EXECUTION_MODE: "PRODUCTION",
  INSURANCE_KERNEL_ENABLE_BIND_REQUEST: "1",
  INSURANCE_KERNEL_PRODUCTION_BIND_ACK: "I_UNDERSTAND_BIND_IS_LIVE",
});
expect(previewProductionRequest.mode === "SANDBOX", "preview/development must narrow production request to sandbox");
expect(!previewProductionRequest.features.bindRequest, "narrowed preview mode must not authorize binding");
expect(!previewProductionRequest.simulatorOutputsAllowed, "sandbox is not simulation");

const production = config({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  INSURANCE_KERNEL_EXECUTION_MODE: "PRODUCTION",
  INSURANCE_KERNEL_ENABLE_PROFILE_CAPTURE: "1",
  INSURANCE_KERNEL_ENABLE_QUOTE_REQUEST: "1",
  INSURANCE_KERNEL_ENABLE_BIND_REQUEST: "1",
  INSURANCE_KERNEL_PRODUCTION_BIND_ACK: "I_UNDERSTAND_BIND_IS_LIVE",
});
expect(production.mode === "PRODUCTION", "explicit production configuration should remain production");
expect(production.features.bindRequest, "production bind requires both exact flag and acknowledgement");
expect(!production.simulatorOutputsAllowed, "production must never permit simulator outputs");
let simulatorRejected = false;
try {
  assertSimulatorOutputsAllowed(production);
} catch {
  simulatorRejected = true;
}
expect(simulatorRejected, "production simulator assertion must fail");

const unknownHostedTier = config({
  NODE_ENV: "development",
  VERCEL_ENV: "staging-unknown",
  INSURANCE_KERNEL_EXECUTION_MODE: "SIMULATION",
});
expect(unknownHostedTier.mode === "DISABLED", "unknown hosted deployment tier must fail closed");

const orphanedPortal = config({
  NODE_ENV: "development",
  INSURANCE_KERNEL_EXECUTION_MODE: "SIMULATION",
  INSURANCE_KERNEL_ENABLE_CASE_PORTAL: "1",
});
expect(!orphanedPortal.features.caseRecord, "case record must default off");
expect(!orphanedPortal.features.casePortal, "portal flag cannot widen a disabled case record");

const recordWithoutCapture = config({
  NODE_ENV: "development",
  INSURANCE_KERNEL_EXECUTION_MODE: "SIMULATION",
  INSURANCE_KERNEL_ENABLE_CASE_RECORD: "1",
});
expect(!recordWithoutCapture.features.caseRecord, "case record cannot bypass profile-capture gate");

const quoteWithoutCase = config({
  NODE_ENV: "development",
  INSURANCE_KERNEL_EXECUTION_MODE: "SIMULATION",
  INSURANCE_KERNEL_ENABLE_QUOTE_REQUEST: "1",
});
expect(!quoteWithoutCase.features.quoteRequest, "delivery cannot bypass durable profile/case gates");

// Narrowing is monotonic: a caller cannot widen any runtime ceiling.
expect(narrowExecutionMode("SIMULATION", "SANDBOX") === "SIMULATION", "narrowing must retain lower requested mode");
expect(narrowExecutionMode("PRODUCTION", "SANDBOX") === "SANDBOX", "narrowing must cap production at sandbox");
expect(narrowExecutionMode("SANDBOX", "SIMULATION") === "SIMULATION", "narrowing must never widen a ceiling");

console.log("insurance-kernel execution validation passed");
