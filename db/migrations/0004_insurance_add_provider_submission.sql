-- A2 provider-neutral durable submission record. No quote/policy/claim facts.

ALTER TABLE insurance_cases DROP CONSTRAINT insurance_cases_status_check;
ALTER TABLE insurance_submissions DROP CONSTRAINT insurance_submissions_status_check;
ALTER TABLE insurance_cases ADD CONSTRAINT insurance_cases_status_check
  CHECK (status IN ('DRAFT', 'COLLECTING_FACTS', 'READY_FOR_SUBMISSION', 'SUBMISSION_IN_PROGRESS', 'WITHDRAWN'));
ALTER TABLE insurance_submissions ADD CONSTRAINT insurance_submissions_status_check
  CHECK (status IN ('DRAFT', 'READY', 'SUBMITTING', 'AWAITING_PROVIDER', 'SUBMITTED', 'PROVIDER_ERROR', 'WITHDRAWN'));

CREATE OR REPLACE FUNCTION insurance_case_mode_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.execution_mode IS DISTINCT FROM NEW.execution_mode THEN
    RAISE EXCEPTION 'insurance case execution_mode is immutable';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('COLLECTING_FACTS', 'READY_FOR_SUBMISSION', 'WITHDRAWN'))
    OR (OLD.status = 'COLLECTING_FACTS' AND NEW.status IN ('READY_FOR_SUBMISSION', 'WITHDRAWN'))
    OR (OLD.status = 'READY_FOR_SUBMISSION' AND NEW.status IN ('COLLECTING_FACTS', 'SUBMISSION_IN_PROGRESS', 'WITHDRAWN'))
    OR (OLD.status = 'SUBMISSION_IN_PROGRESS' AND NEW.status IN ('COLLECTING_FACTS', 'READY_FOR_SUBMISSION', 'WITHDRAWN'))
  ) THEN
    RAISE EXCEPTION 'forbidden insurance case transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION insurance_protect_finalized_submission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status <> 'DRAFT' AND (
    OLD.id IS DISTINCT FROM NEW.id OR OLD.case_id IS DISTINCT FROM NEW.case_id
    OR OLD.version IS DISTINCT FROM NEW.version OR OLD.questionnaire_version IS DISTINCT FROM NEW.questionnaire_version
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.consent_artifact_id IS DISTINCT FROM NEW.consent_artifact_id OR OLD.supersedes_submission_id IS DISTINCT FROM NEW.supersedes_submission_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  ) THEN RAISE EXCEPTION 'submission content cannot change during finalization'; END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status='DRAFT' AND NEW.status IN ('READY','WITHDRAWN'))
    OR (OLD.status='READY' AND NEW.status IN ('SUBMITTING','WITHDRAWN'))
    OR (OLD.status='SUBMITTING' AND NEW.status IN ('AWAITING_PROVIDER','PROVIDER_ERROR'))
    OR (OLD.status='AWAITING_PROVIDER' AND NEW.status IN ('SUBMITTED','PROVIDER_ERROR','WITHDRAWN'))
    OR (OLD.status='PROVIDER_ERROR' AND NEW.status='AWAITING_PROVIDER')
  ) THEN RAISE EXCEPTION 'forbidden insurance submission transition % -> %', OLD.status, NEW.status; END IF;
  IF OLD.status <> 'DRAFT' AND (
    OLD.id IS DISTINCT FROM NEW.id OR OLD.case_id IS DISTINCT FROM NEW.case_id
    OR OLD.version IS DISTINCT FROM NEW.version OR OLD.questionnaire_version IS DISTINCT FROM NEW.questionnaire_version
    OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
    OR OLD.consent_artifact_id IS DISTINCT FROM NEW.consent_artifact_id OR OLD.finalized_at IS DISTINCT FROM NEW.finalized_at
    OR OLD.supersedes_submission_id IS DISTINCT FROM NEW.supersedes_submission_id OR OLD.created_at IS DISTINCT FROM NEW.created_at
  ) THEN RAISE EXCEPTION 'finalized submission content is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE insurance_provider_connections (
  id UUID PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  counterparty_role TEXT NOT NULL CHECK (counterparty_role IN ('BROKERAGE','AGENCY','MGA','INSURER','RATER','BMS')),
  supported_execution_modes TEXT[] NOT NULL CHECK (cardinality(supported_execution_modes) > 0),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE insurance_provider_submissions (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES insurance_cases(id) ON DELETE RESTRICT,
  submission_id UUID NOT NULL REFERENCES insurance_submissions(id) ON DELETE RESTRICT,
  provider_connection_id UUID NOT NULL REFERENCES insurance_provider_connections(id) ON DELETE RESTRICT,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('SIMULATION','SANDBOX','PRODUCTION')),
  status TEXT NOT NULL CHECK (status IN ('PENDING_DISPATCH','AWAITING_PROVIDER','ACKNOWLEDGED','RETRY_SCHEDULED','DEAD_LETTER','RECONCILIATION_REQUIRED')),
  provider_idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  provider_external_id TEXT,
  provider_status TEXT,
  raw_request_reference TEXT,
  raw_response_reference TEXT,
  provider_schema_version TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  terminal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, provider_connection_id),
  UNIQUE (provider_connection_id, provider_idempotency_key),
  CHECK ((status = 'ACKNOWLEDGED') = (acknowledged_at IS NOT NULL))
);
CREATE INDEX insurance_provider_submissions_case_idx ON insurance_provider_submissions(case_id, created_at DESC);
