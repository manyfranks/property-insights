import { createHash } from "node:crypto";

export const ANSWER_ORIGINS = ["USER", "LISTING", "ASSESSMENT", "PROVIDER", "MODEL_HINT", "BROKER"] as const;
export type AnswerOrigin = (typeof ANSWER_ORIGINS)[number];
export type AnswerKind = "EVIDENCE" | "ATTESTATION";

export interface SubmissionAnswer {
  id: string;
  questionKey: string;
  answerKind: AnswerKind;
  value: unknown;
  origin: AnswerOrigin;
  sourceReference?: string | null;
  correctsAnswerId?: string | null;
}

export function assertAnswerProvenance(answer: SubmissionAnswer): void {
  if (!answer.questionKey.trim()) throw new Error("insurance-a1: answer question key is required");
  if (answer.correctsAnswerId && (answer.origin !== "USER" || answer.answerKind !== "ATTESTATION")) {
    throw new Error("insurance-a1: corrections must be separate USER attestations");
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Produces a stable JSON representation for idempotency fingerprints. JSON's
 * ordinary object serialization preserves insertion order, which is not a
 * safe equivalence definition for requests received over an API. Arrays keep
 * their order (where order is meaningful); object keys are recursively
 * sorted. Inputs to the insurance commands are validated before reaching
 * this function, so unsupported JSON values are rejected rather than being
 * silently transformed into an ambiguous fingerprint.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("insurance-a1: canonical request contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("insurance-a1: canonical request contains an unsupported value");
}

export function canonicalSha256(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function hashAccessToken(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("insurance-a1: access token must be 32-byte base64url");
  }
  return sha256(token);
}

export function assertIdempotencyKey(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("insurance-a1: idempotency key must be a UUID");
  }
}
