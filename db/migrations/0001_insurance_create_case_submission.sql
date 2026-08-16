-- A1 expand migration: durable cases, consent, immutable submission versions,
-- provenance-preserving answers, timeline, and audit. No provider-delivery state.

CREATE TABLE insurance_cases (
  id UUID PRIMARY KEY,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('SIMULATION', 'SANDBOX', 'PRODUCTION')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'COLLECTING_FACTS', 'READY_FOR_SUBMISSION', 'WITHDRAWN')),
  owner_user_id TEXT,
  legacy_coverage_profile_id UUID UNIQUE REFERENCES coverage_profiles(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL CHECK (country IN ('US', 'CA')),
  region TEXT NOT NULL,
  insurance_line TEXT NOT NULL CHECK (insurance_line IN ('homeowner', 'landlord', 'tenant', 'strata', 'commercial')),
  access_token_hash CHAR(64) UNIQUE,
  access_token_expires_at TIMESTAMPTZ,
  access_token_revoked_at TIMESTAMPTZ,
  historical_shell BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    historical_shell
    OR owner_user_id IS NOT NULL
    OR (access_token_hash IS NOT NULL AND access_token_expires_at IS NOT NULL)
  )
);

CREATE INDEX insurance_cases_owner_created_idx ON insurance_cases(owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL;
CREATE INDEX insurance_cases_access_idx ON insurance_cases(access_token_hash)
  WHERE access_token_hash IS NOT NULL AND access_token_revoked_at IS NULL;

CREATE TABLE insurance_parties (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('PERSON', 'ORGANIZATION')),
  display_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE insurance_case_parties (
  case_id UUID NOT NULL REFERENCES insurance_cases(id) ON DELETE RESTRICT,
  party_id UUID NOT NULL REFERENCES insurance_parties(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('APPLICANT', 'INSURED', 'CONTACT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, party_id, role)
);

CREATE TABLE insurance_consent_artifacts (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES insurance_cases(id) ON DELETE RESTRICT,
  version TEXT NOT NULL,
  language TEXT NOT NULL,
  purpose TEXT NOT NULL,
  exact_text TEXT NOT NULL,
  intended_recipients JSONB NOT NULL CHECK (jsonb_typeof(intended_recipients) = 'array'),
  field_scope JSONB NOT NULL CHECK (jsonb_typeof(field_scope) = 'array'),
  granted_at TIMESTAMPTZ NOT NULL,
  withdrawn_at TIMESTAMPTZ,
  withdrawal_reason TEXT,
  supersedes_consent_id UUID REFERENCES insurance_consent_artifacts(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, case_id),
  UNIQUE (case_id, version),
  FOREIGN KEY (supersedes_consent_id, case_id)
    REFERENCES insurance_consent_artifacts(id, case_id) ON DELETE RESTRICT,
  CHECK ((withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR withdrawn_at IS NOT NULL)
);

CREATE TABLE insurance_submissions (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES insurance_cases(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'READY', 'WITHDRAWN')),
  questionnaire_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  consent_artifact_id UUID NOT NULL REFERENCES insurance_consent_artifacts(id) ON DELETE RESTRICT,
  finalized_at TIMESTAMPTZ,
  supersedes_submission_id UUID REFERENCES insurance_submissions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, case_id),
  UNIQUE (case_id, version),
  UNIQUE (case_id, idempotency_key),
  FOREIGN KEY (consent_artifact_id, case_id)
    REFERENCES insurance_consent_artifacts(id, case_id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_submission_id, case_id)
    REFERENCES insurance_submissions(id, case_id) ON DELETE RESTRICT,
  CHECK ((status = 'DRAFT' AND finalized_at IS NULL) OR (status <> 'DRAFT' AND finalized_at IS NOT NULL))
);

CREATE INDEX insurance_submissions_case_version_idx ON insurance_submissions(case_id, version DESC);

CREATE TABLE insurance_submission_answers (
  id UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES insurance_submissions(id) ON DELETE RESTRICT,
  question_key TEXT NOT NULL,
  answer_kind TEXT NOT NULL CHECK (answer_kind IN ('EVIDENCE', 'ATTESTATION')),
  value JSONB NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('USER', 'LISTING', 'ASSESSMENT', 'PROVIDER', 'MODEL_HINT', 'BROKER')),
  source_reference TEXT,
  corrects_answer_id UUID REFERENCES insurance_submission_answers(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, question_key, answer_kind, origin),
  CHECK (corrects_answer_id IS NULL OR (origin = 'USER' AND answer_kind = 'ATTESTATION'))
);

CREATE TABLE insurance_case_timeline_events (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES insurance_cases(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('CUSTOMER', 'USER', 'SERVICE', 'MIGRATION')),
  actor_id TEXT,
  correlation_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX insurance_case_timeline_case_idx ON insurance_case_timeline_events(case_id, occurred_at, id);
CREATE UNIQUE INDEX insurance_case_timeline_idempotency_idx
  ON insurance_case_timeline_events(case_id, event_type, correlation_id);

CREATE TABLE insurance_audit_events (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES insurance_cases(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('CUSTOMER', 'USER', 'SERVICE', 'MIGRATION')),
  actor_id TEXT,
  correlation_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX insurance_audit_case_idx ON insurance_audit_events(case_id, occurred_at, id);
CREATE UNIQUE INDEX insurance_audit_idempotency_idx
  ON insurance_audit_events(case_id, event_type, correlation_id, subject_id);

CREATE OR REPLACE FUNCTION insurance_forbid_append_only_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER insurance_timeline_append_only
  BEFORE UPDATE OR DELETE ON insurance_case_timeline_events
  FOR EACH ROW EXECUTE FUNCTION insurance_forbid_append_only_mutation();
CREATE TRIGGER insurance_audit_append_only
  BEFORE UPDATE OR DELETE ON insurance_audit_events
  FOR EACH ROW EXECUTE FUNCTION insurance_forbid_append_only_mutation();

CREATE OR REPLACE FUNCTION insurance_protect_consent_artifact()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.case_id IS DISTINCT FROM NEW.case_id
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.language IS DISTINCT FROM NEW.language
    OR OLD.purpose IS DISTINCT FROM NEW.purpose
    OR OLD.exact_text IS DISTINCT FROM NEW.exact_text
    OR OLD.intended_recipients IS DISTINCT FROM NEW.intended_recipients
    OR OLD.field_scope IS DISTINCT FROM NEW.field_scope
    OR OLD.granted_at IS DISTINCT FROM NEW.granted_at
    OR OLD.supersedes_consent_id IS DISTINCT FROM NEW.supersedes_consent_id
  THEN
    RAISE EXCEPTION 'consent artifact content is immutable';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'withdrawn consent artifact is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER insurance_consent_immutable
  BEFORE UPDATE ON insurance_consent_artifacts
  FOR EACH ROW EXECUTE FUNCTION insurance_protect_consent_artifact();

CREATE OR REPLACE FUNCTION insurance_protect_finalized_submission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status IN ('READY', 'WITHDRAWN') AND (
    OLD.id IS DISTINCT FROM NEW.id
    OR OLD.case_id IS DISTINCT FROM NEW.case_id
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.questionnaire_version IS DISTINCT FROM NEW.questionnaire_version
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
    OR OLD.consent_artifact_id IS DISTINCT FROM NEW.consent_artifact_id
    OR OLD.supersedes_submission_id IS DISTINCT FROM NEW.supersedes_submission_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  ) THEN
    RAISE EXCEPTION 'submission content cannot change during finalization';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('READY', 'WITHDRAWN'))
    OR (OLD.status = 'READY' AND NEW.status = 'WITHDRAWN')
  ) THEN
    RAISE EXCEPTION 'forbidden insurance submission transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status IN ('READY', 'WITHDRAWN') THEN
    IF NOT (
      OLD.status = 'READY' AND NEW.status = 'WITHDRAWN'
      AND OLD.id = NEW.id
      AND OLD.case_id = NEW.case_id
      AND OLD.version = NEW.version
      AND OLD.questionnaire_version = NEW.questionnaire_version
      AND OLD.idempotency_key = NEW.idempotency_key
      AND OLD.consent_artifact_id = NEW.consent_artifact_id
      AND OLD.finalized_at = NEW.finalized_at
      AND OLD.supersedes_submission_id IS NOT DISTINCT FROM NEW.supersedes_submission_id
      AND OLD.created_at = NEW.created_at
    ) THEN
      RAISE EXCEPTION 'finalized submission is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER insurance_submission_immutable
  BEFORE UPDATE ON insurance_submissions
  FOR EACH ROW EXECUTE FUNCTION insurance_protect_finalized_submission();

CREATE OR REPLACE FUNCTION insurance_protect_finalized_answers()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent_status TEXT;
  correction_case UUID;
  answer_case UUID;
  correction_question TEXT;
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.corrects_answer_id IS NOT NULL THEN
    SELECT s.case_id, a.question_key INTO correction_case, correction_question
    FROM insurance_submission_answers a
    JOIN insurance_submissions s ON s.id = a.submission_id
    WHERE a.id = NEW.corrects_answer_id;
    SELECT case_id INTO answer_case FROM insurance_submissions WHERE id = NEW.submission_id;
    IF correction_case IS NULL OR correction_case <> answer_case OR correction_question <> NEW.question_key THEN
      RAISE EXCEPTION 'correction must reference the same question in the same insurance case';
    END IF;
  END IF;
  SELECT status INTO parent_status
  FROM insurance_submissions
  WHERE id = COALESCE(OLD.submission_id, NEW.submission_id);
  IF parent_status IN ('READY', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'answers for a finalized submission are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER insurance_answer_finalized_guard
  BEFORE INSERT OR UPDATE OR DELETE ON insurance_submission_answers
  FOR EACH ROW EXECUTE FUNCTION insurance_protect_finalized_answers();

CREATE OR REPLACE FUNCTION insurance_case_mode_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.execution_mode IS DISTINCT FROM NEW.execution_mode THEN
    RAISE EXCEPTION 'insurance case execution_mode is immutable';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('COLLECTING_FACTS', 'READY_FOR_SUBMISSION', 'WITHDRAWN'))
    OR (OLD.status = 'COLLECTING_FACTS' AND NEW.status IN ('READY_FOR_SUBMISSION', 'WITHDRAWN'))
    OR (OLD.status = 'READY_FOR_SUBMISSION' AND NEW.status = 'WITHDRAWN')
  ) THEN
    RAISE EXCEPTION 'forbidden insurance case transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER insurance_case_execution_mode_immutable
  BEFORE UPDATE ON insurance_cases
  FOR EACH ROW EXECUTE FUNCTION insurance_case_mode_immutable();
