-- Commercial usage is intentionally separate from ingest_rate_limit_buckets.
-- The latter protects the service from abuse; these rows describe a tenant's
-- plan and only reject traffic when an owner explicitly enables hard limits.
BEGIN;

CREATE TABLE plans (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  included_events bigint NOT NULL,
  included_errors bigint NOT NULL,
  included_behavior_events bigint NOT NULL,
  included_replay_bytes bigint NOT NULL,
  retention_days_max integer NOT NULL,
  export_concurrency integer NOT NULL,
  member_limit integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(code) BETWEEN 1 AND 100),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (included_events >= 0 AND included_errors >= 0 AND included_behavior_events >= 0 AND included_replay_bytes >= 0),
  CHECK (retention_days_max > 0 AND export_concurrency > 0 AND member_limit > 0)
);

-- There is no payment provider in this schema.  The built-in plan is an
-- internal allocation and must never be represented as a charged subscription.
INSERT INTO plans (id, code, name, included_events, included_errors, included_behavior_events, included_replay_bytes, retention_days_max, export_concurrency, member_limit)
VALUES ('00000000-0000-4000-8000-000000000021', 'internal_free', 'Internal Free', 100000, 10000, 100000, 1073741824, 365, 1, 20);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  cycle_started_at timestamptz NOT NULL,
  cycle_ends_at timestamptz NOT NULL,
  hard_limit_enabled boolean NOT NULL DEFAULT false,
  grace_percent integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('active', 'paused', 'cancelled')),
  CHECK (cycle_ends_at > cycle_started_at),
  CHECK (grace_percent BETWEEN 0 AND 1000)
);
CREATE INDEX subscriptions_tenant_active_idx ON subscriptions (tenant_id) WHERE status = 'active';

CREATE TABLE usage_cycle_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  cycle_started_at timestamptz NOT NULL,
  lane text NOT NULL,
  accepted_events bigint NOT NULL DEFAULT 0,
  accepted_bytes bigint NOT NULL DEFAULT 0,
  adjustment_events bigint NOT NULL DEFAULT 0,
  adjustment_bytes bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subscription_id, cycle_started_at, lane),
  CHECK (lane IN ('analytics', 'error', 'behavior', 'replay', 'performance')),
  CHECK (accepted_events >= 0 AND accepted_bytes >= 0)
);
CREATE INDEX usage_cycle_counters_tenant_cycle_idx ON usage_cycle_counters (tenant_id, cycle_started_at DESC, lane);

CREATE TABLE usage_adjustments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  cycle_started_at timestamptz NOT NULL,
  lane text NOT NULL,
  delta_events bigint NOT NULL DEFAULT 0,
  delta_bytes bigint NOT NULL DEFAULT 0,
  reason text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lane IN ('analytics', 'error', 'behavior', 'replay', 'performance')),
  CHECK (delta_events <> 0 OR delta_bytes <> 0),
  CHECK (length(reason) BETWEEN 1 AND 500)
);
CREATE INDEX usage_adjustments_tenant_cycle_idx ON usage_adjustments (tenant_id, cycle_started_at DESC, created_at DESC);

-- Existing and future tenants receive an internal allocation.  Using the
-- tenant UUID for the subscription ID avoids requiring a UUID extension.
INSERT INTO subscriptions (id, tenant_id, plan_id, cycle_started_at, cycle_ends_at)
SELECT id, id, '00000000-0000-4000-8000-000000000021', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month'
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE FUNCTION create_default_subscription_for_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO subscriptions (id, tenant_id, plan_id, cycle_started_at, cycle_ends_at)
  VALUES (NEW.id, NEW.id, '00000000-0000-4000-8000-000000000021', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');
  RETURN NEW;
END;
$$;
CREATE TRIGGER tenants_default_subscription_after_insert
  AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION create_default_subscription_for_tenant();

COMMIT;
