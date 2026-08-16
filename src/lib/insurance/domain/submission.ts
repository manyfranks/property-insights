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
