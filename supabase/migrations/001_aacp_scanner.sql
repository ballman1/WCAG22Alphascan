-- ============================================================
-- AACP Accessibility Scanner — Supabase Schema
-- Alphapointe Accessibility Certification Program
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- CLIENTS
-- Organizations under AACP certification management
-- ============================================================
create table clients (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  domain        text not null,
  tier          text not null check (tier in ('tier1', 'tier2', 'tier3')),
  status        text not null default 'active' check (status in ('active', 'paused', 'expired')),
  certified_at  timestamptz,
  cert_expires  timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- ENGAGEMENTS
-- A single certification or re-audit engagement
-- ============================================================
create table engagements (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references clients(id) on delete cascade,
  label         text not null,                  -- e.g. "Q2 2026 Initial Audit"
  status        text not null default 'pending'
                  check (status in ('pending','scanning','in_review','complete','failed')),
  scan_scope    text[] not null default '{}',   -- list of URLs to scan
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- ============================================================
-- SCANS
-- One automated axe-core scan run against a single URL
-- ============================================================
create table scans (
  id              uuid primary key default uuid_generate_v4(),
  engagement_id   uuid not null references engagements(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  url             text not null,
  status          text not null default 'pending'
                    check (status in ('pending','running','complete','error')),
  axe_version     text,
  wcag_level      text not null default 'wcag22aa',
  violations_raw  jsonb,               -- full axe-core result object
  passes_count    int default 0,
  violations_count int default 0,
  incomplete_count int default 0,
  inapplicable_count int default 0,
  duration_ms     int,
  error_message   text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- ============================================================
-- VIOLATIONS
-- Normalized per-violation rows extracted from axe-core JSON
-- ============================================================
create table violations (
  id              uuid primary key default uuid_generate_v4(),
  scan_id         uuid not null references scans(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  engagement_id   uuid not null references engagements(id) on delete cascade,

  -- axe-core fields
  rule_id         text not null,        -- e.g. "color-contrast"
  description     text not null,
  help            text not null,        -- short human label
  help_url        text,
  impact          text check (impact in ('critical','serious','moderate','minor')),

  -- WCAG mapping
  wcag_criteria   text[],              -- e.g. ['wcag1.4.3','wcag2aa']
  wcag_sc         text,                -- primary SC, e.g. "1.4.3"

  -- Element context
  element_html    text,
  element_target  text,
  failure_summary text,

  -- Tester workflow
  human_verified   boolean default false,
  tester_notes     text,
  remediated       boolean default false,
  remediated_at    timestamptz,

  created_at      timestamptz not null default now()
);

-- ============================================================
-- DELTA ALERTS
-- New violations found in a rescan vs. prior baseline
-- (powers Tier 3 monitoring alerts)
-- ============================================================
create table delta_alerts (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references clients(id) on delete cascade,
  scan_id         uuid not null references scans(id) on delete cascade,
  violation_id    uuid not null references violations(id) on delete cascade,
  rule_id         text not null,
  impact          text,
  url             text not null,
  element_target  text,
  resolved        boolean default false,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- CERTIFICATIONS
-- Formal certification records tied to an engagement
-- ============================================================
create table certifications (
  id                  uuid primary key default uuid_generate_v4(),
  client_id           uuid not null references clients(id) on delete cascade,
  engagement_id       uuid not null references engagements(id) on delete cascade,
  status              text not null check (status in ('certified','not_certified','conditional')),
  critical_count      int not null default 0,
  high_count          int not null default 0,
  medium_count        int not null default 0,
  low_count           int not null default 0,
  pages_tested        int not null default 0,
  wcag_level          text not null default 'WCAG 2.2 AA',
  issued_at           timestamptz not null default now(),
  expires_at          timestamptz,
  seal_token          text unique default encode(gen_random_bytes(16), 'hex'),
  tester_sign_off     text,
  notes               text
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_scans_client    on scans(client_id);
create index idx_scans_eng       on scans(engagement_id);
create index idx_violations_scan on violations(scan_id);
create index idx_violations_rule on violations(rule_id);
create index idx_violations_impact on violations(impact);
create index idx_delta_client    on delta_alerts(client_id, resolved);
create index idx_cert_client     on certifications(client_id);

-- ============================================================
-- ROW LEVEL SECURITY (enable for production)
-- ============================================================
alter table clients         enable row level security;
alter table engagements     enable row level security;
alter table scans           enable row level security;
alter table violations      enable row level security;
alter table delta_alerts    enable row level security;
alter table certifications  enable row level security;

-- Open policy for service_role (scanner uses service key)
create policy "service_role_all_clients"     on clients         for all using (true);
create policy "service_role_all_engagements" on engagements     for all using (true);
create policy "service_role_all_scans"       on scans           for all using (true);
create policy "service_role_all_violations"  on violations      for all using (true);
create policy "service_role_all_deltas"      on delta_alerts    for all using (true);
create policy "service_role_all_certs"       on certifications  for all using (true);

-- ============================================================
-- SEAL VERIFICATION FUNCTION
-- Public endpoint: verify a certification seal by token
-- ============================================================
create or replace function verify_seal(token text)
returns jsonb
language plpgsql security definer
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'valid',        true,
    'client',       c.name,
    'domain',       c.domain,
    'status',       cert.status,
    'wcag_level',   cert.wcag_level,
    'issued_at',    cert.issued_at,
    'expires_at',   cert.expires_at,
    'pages_tested', cert.pages_tested
  ) into result
  from certifications cert
  join clients c on c.id = cert.client_id
  where cert.seal_token = token
    and cert.expires_at > now();

  if result is null then
    return jsonb_build_object('valid', false, 'reason', 'Token not found or expired');
  end if;

  return result;
end;
$$;

-- ============================================================
-- SAMPLE SEED DATA (remove before production)
-- ============================================================
insert into clients (name, domain, tier) values
  ('City of Springfield', 'springfield.gov', 'tier2'),
  ('Riverside USD', 'rsd.edu', 'tier3'),
  ('Harbor Transit Authority', 'harbortransit.org', 'tier1');
