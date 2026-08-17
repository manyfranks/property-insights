import { canonicalSha256 } from "@/lib/insurance/domain/submission";
import {
  assertProviderMode,
  DETERMINISTIC_SIMULATOR_PROVIDER_KEY,
  type ProviderAcknowledgement,
  type ProviderWebhookEvent,
  type SubmissionProvider,
  type SubmissionProviderRequest,
  verifyHmacWebhook,
} from "@/lib/insurance/domain/delivery";

/**
 * Deterministic demo adapter. It has no network client or production mode,
 * and all identifiers visibly carry the SIM prefix. Scenario selection is
 * encoded only in the test/demo request hash; it never reads customer facts.
 */
export class DeterministicSubmissionProvider implements SubmissionProvider {
  readonly key = DETERMINISTIC_SIMULATOR_PROVIDER_KEY;
  readonly supportedModes = ["SIMULATION", "SANDBOX"] as const;

  constructor(private readonly webhookSecret: string) {}

  async submit(request: SubmissionProviderRequest): Promise<ProviderAcknowledgement> {
    assertProviderMode(this, request.envelope.executionMode);
    const seed = canonicalSha256({ requestHash: request.requestHash, submissionId: request.submissionId });
    const scenario = request.simulationScenario ?? "SUCCESS";
    if (scenario === "PERMANENT_FAILURE") {
      return { kind: "PERMANENT_FAILURE", providerStatus: "SIMULATED_PERMANENT_FAILURE", normalizedReasonCodes: ["SIMULATED"] };
    }
    if (scenario === "RETRYABLE_FAILURE") {
      return { kind: "RETRYABLE_FAILURE", providerStatus: "SIMULATED_RETRY", retryAfterSeconds: 1, normalizedReasonCodes: ["SIMULATED_RETRY"] };
    }
    if (scenario === "DELAYED_ACK" || scenario === "TIMEOUT") {
      return { kind: "PENDING", providerExternalId: `SIM-SUB-${seed.slice(0, 16)}`, providerStatus: "SIMULATED_PENDING" };
    }
    return { kind: "ACKNOWLEDGED", providerExternalId: `SIM-SUB-${seed.slice(0, 16)}`, providerStatus: "SIMULATED_ACKNOWLEDGED" };
  }

  verifyWebhook(rawBody: string, signature: string, timestamp: string): ProviderWebhookEvent {
    verifyHmacWebhook(rawBody, signature, timestamp, this.webhookSecret);
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object") throw new Error("insurance-a2: simulator webhook must be an object");
    const event = parsed as Partial<ProviderWebhookEvent>;
    if (event.providerKey !== this.key || !event.providerEventId || !event.occurredAt || !event.eventType) {
      throw new Error("insurance-a2: malformed simulator webhook");
    }
    return event as ProviderWebhookEvent;
  }
}
