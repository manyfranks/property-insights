import { createHmac, randomUUID } from "node:crypto";
import { DeterministicSubmissionProvider } from "../src/lib/insurance/simulation/deterministic-submission-provider";

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`[insurance-a2-simulator] ${message}`);
}

async function main(): Promise<void> {
  const secret = "simulator-contract-secret";
  const provider = new DeterministicSubmissionProvider(secret);
  const base = {
    envelope: {
      requestId: randomUUID(), idempotencyKey: randomUUID(), correlationId: randomUUID(), causationId: null,
      executionMode: "SIMULATION" as const, caseId: randomUUID(), aggregateId: randomUUID(), schemaVersion: "a2-v1",
      consentArtifactIds: [randomUUID()], authorityDecisionId: null, providerConnectionId: randomUUID(), requestedAt: new Date().toISOString(),
    },
    submissionId: randomUUID(), submissionVersion: 1, requestHash: "a".repeat(64),
  };
  expect((await provider.submit(base)).kind === "ACKNOWLEDGED", "clean simulator path must acknowledge deterministically");
  expect((await provider.submit({ ...base, simulationScenario: "DELAYED_ACK" })).kind === "PENDING", "delayed acknowledgement must remain pending");
  expect((await provider.submit({ ...base, simulationScenario: "TIMEOUT" })).kind === "PENDING", "timeout must remain ambiguous/pending");
  expect((await provider.submit({ ...base, simulationScenario: "RETRYABLE_FAILURE" })).kind === "RETRYABLE_FAILURE", "retry scenario must be explicit");
  expect((await provider.submit({ ...base, simulationScenario: "PERMANENT_FAILURE" })).kind === "PERMANENT_FAILURE", "permanent failure must be explicit");
  let productionRejected = false;
  try { await provider.submit({ ...base, envelope: { ...base.envelope, executionMode: "PRODUCTION" } }); } catch { productionRejected = true; }
  expect(productionRejected, "simulator must be impossible in production");

  const body = JSON.stringify({ providerKey: provider.key, providerEventId: randomUUID(), occurredAt: new Date().toISOString(), eventType: "SUBMISSION_ACKNOWLEDGED" });
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  expect(provider.verifyWebhook(body, signature, timestamp).eventType === "SUBMISSION_ACKNOWLEDGED", "signed webhook must verify");
  console.log("insurance A2 deterministic simulator contract passed");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
