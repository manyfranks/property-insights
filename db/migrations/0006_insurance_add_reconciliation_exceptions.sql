-- A2 owned exception evidence. A3 supplies the human workbench.

CREATE TABLE insurance_reconciliation_runs (
  id UUID PRIMARY KEY,
  provider_connection_id UUID NOT NULL REFERENCES insurance_provider_connections(id) ON DELETE RESTRICT,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('SIMULATION','SANDBOX','PRODUCTION')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  result_hash CHAR(64)
);

CREATE TABLE insurance_reconciliation_items (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES insurance_reconciliation_runs(id) ON DELETE RESTRICT,
  provider_submission_id UUID NOT NULL REFERENCES insurance_provider_submissions(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('MATCH','MISMATCH','UNAVAILABLE')),
  detail_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, provider_submission_id)
);

CREATE TABLE insurance_operator_exceptions (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES insurance_cases(id) ON DELETE RESTRICT,
  provider_submission_id UUID REFERENCES insurance_provider_submissions(id) ON DELETE RESTRICT,
  exception_type TEXT NOT NULL CHECK (exception_type IN ('PROVIDER_TIMEOUT','RETRY_EXHAUSTED','PERMANENT_FAILURE','WEBHOOK_CONFLICT','WEBHOOK_OUT_OF_ORDER','RECONCILIATION_MISMATCH')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  reason_code TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX insurance_operator_exceptions_queue_idx ON insurance_operator_exceptions(status, created_at)
  WHERE status <> 'RESOLVED';

CREATE TABLE insurance_operator_exception_events (
  id UUID PRIMARY KEY,
  exception_id UUID NOT NULL REFERENCES insurance_operator_exceptions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('SERVICE','USER','MIGRATION')),
  actor_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER insurance_operator_exception_events_append_only BEFORE UPDATE OR DELETE ON insurance_operator_exception_events
  FOR EACH ROW EXECUTE FUNCTION insurance_forbid_append_only_mutation();
