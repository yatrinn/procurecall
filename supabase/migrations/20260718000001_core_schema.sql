-- ProcureCall core schema.
-- All access goes through server routes using the secret key (service_role).
-- RLS is enabled on every table with NO policies: anon/authenticated are denied.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- verticals: deployed configuration snapshots
-- ---------------------------------------------------------------------------
create table public.verticals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  config jsonb not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- job_specs: versioned, fingerprinted job specifications
-- ---------------------------------------------------------------------------
create table public.job_specs (
  id uuid primary key default gen_random_uuid(),
  vertical_slug text not null references public.verticals(slug),
  spec jsonb not null,
  spec_version integer not null default 1,
  parent_spec_id uuid references public.job_specs(id),
  authorized_levers jsonb not null default '{}'::jsonb,
  confirmed_by_user boolean not null default false,
  confirmed_at timestamptz,
  canonical text,
  spec_fingerprint text,
  intake_source text not null check (intake_source in ('voice', 'document', 'manual')),
  created_at timestamptz not null default now(),
  -- a confirmed spec must carry its canonical form and fingerprint
  constraint confirmed_requires_fingerprint
    check (not confirmed_by_user or (spec_fingerprint is not null and canonical is not null))
);

create index job_specs_fingerprint_idx on public.job_specs (spec_fingerprint);

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source text not null check (source in ('tavily', 'simulated', 'manual')),
  is_simulated boolean not null default true,
  location text,
  contact jsonb not null default '{}'::jsonb,
  distance_km numeric,
  supported_categories text[] not null default '{}',
  operating_hours text,
  reliability_history jsonb not null default '[]'::jsonb,
  vertical_slug text not null references public.verticals(slug),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- supplier_policies: PRIVATE commercial state. Never exposed to the buyer
-- agent or the client. Read exclusively by the supplier policy engine.
-- ---------------------------------------------------------------------------
create table public.supplier_policies (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  behavior_profile text not null,
  price_sheet jsonb not null,
  floor jsonb not null,
  concession_ladder jsonb not null,
  disclosure_policy jsonb not null,
  is_held_out boolean not null default false,
  created_at timestamptz not null default now(),
  unique (supplier_id)
);

-- ---------------------------------------------------------------------------
-- call_sessions
-- ---------------------------------------------------------------------------
create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  job_spec_id uuid not null references public.job_specs(id),
  supplier_id uuid not null references public.suppliers(id),
  transport_mode text not null check (transport_mode in
    ('counter_agent', 'human_roleplay', 'real_phone', 'verified_replay')),
  tier text not null default 'text' check (tier in ('text', 'voice')),
  status text not null default 'pending' check (status in
    ('pending', 'in_progress', 'completed', 'failed')),
  started_at timestamptz,
  ended_at timestamptz,
  conversation_id text,
  recording_url text,
  transcript jsonb not null default '[]'::jsonb,
  disclosure_event jsonb,
  friction_events jsonb not null default '[]'::jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  outcome jsonb,
  outcome_type text check (outcome_type in
    ('quote', 'callback_commitment', 'documented_decline')),
  failure_state text,
  spec_fingerprint text not null,
  created_at timestamptz not null default now()
);

create index call_sessions_job_spec_idx on public.call_sessions (job_spec_id);

-- ---------------------------------------------------------------------------
-- quotes (versioned via quote_version + supersedes_quote_id)
-- ---------------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.call_sessions(id),
  supplier_id uuid not null references public.suppliers(id),
  job_spec_id uuid not null references public.job_specs(id),
  spec_fingerprint text not null,
  quote_version integer not null default 1,
  supersedes_quote_id uuid references public.quotes(id),
  technical_match jsonb,
  availability_status text check (availability_status in
    ('confirmed', 'unconfirmed', 'unavailable')),
  availability_evidence jsonb,
  cancellation_terms text,
  validity_until timestamptz,
  missing_information text[] not null default '{}',
  confidence numeric check (confidence >= 0 and confidence <= 1),
  currency text not null default 'EUR',
  tax_basis text not null default 'net' check (tax_basis in ('net', 'gross')),
  vat_rate numeric,
  total_before_negotiation_cents bigint,
  total_after_negotiation_cents bigint,
  status text not null default 'draft' check (status in
    ('draft', 'confirmed', 'expired', 'declined')),
  is_benchmark_outlier boolean not null default false,
  price_breakdown jsonb,
  created_at timestamptz not null default now()
);

create index quotes_fingerprint_idx on public.quotes (spec_fingerprint);
create index quotes_call_idx on public.quotes (call_id);

-- ---------------------------------------------------------------------------
-- quote_lines: a line without transcript evidence cannot be persisted
-- ---------------------------------------------------------------------------
create table public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  call_id uuid not null references public.call_sessions(id),
  label text not null,
  amount_cents bigint,
  unit text,
  is_mandatory boolean not null default true,
  is_conditional boolean not null default false,
  condition_trigger text,
  category text not null check (category in
    ('rental', 'delivery', 'pickup', 'insurance', 'accessory', 'surcharge',
     'discount', 'deposit', 'cleaning', 'fuel', 'late_fee', 'damage_waiver',
     'overtime', 'other')),
  transcript_ref jsonb not null,
  created_at timestamptz not null default now(),
  constraint transcript_ref_shape check (
    transcript_ref ? 'call_id' and transcript_ref ? 'turn_index'
  )
);

create index quote_lines_quote_idx on public.quote_lines (quote_id);

-- ---------------------------------------------------------------------------
-- negotiation_events: a leverage event must cite its verified source quote
-- ---------------------------------------------------------------------------
create table public.negotiation_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.call_sessions(id),
  event_type text not null check (event_type in
    ('leverage_used', 'concession', 'fee_waived', 'fee_reduced', 'rate_reduced',
     'term_improved', 'refusal', 'floor_reached')),
  lever_used text,
  verified_source_quote_id uuid references public.quotes(id),
  tool_returned_evidence jsonb,
  concession_type text,
  amount_before_cents bigint,
  amount_after_cents bigint,
  delta_abs_cents bigint,
  delta_pct numeric,
  transcript_ref jsonb,
  created_at timestamptz not null default now(),
  -- structural truth: leverage events must carry verified evidence
  constraint leverage_requires_verified_source check (
    event_type <> 'leverage_used'
    or (verified_source_quote_id is not null and tool_returned_evidence is not null)
  )
);

create index negotiation_events_call_idx on public.negotiation_events (call_id);

-- ---------------------------------------------------------------------------
-- recommendations
-- ---------------------------------------------------------------------------
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  job_spec_id uuid not null references public.job_specs(id),
  computed_at timestamptz not null default now(),
  hard_constraint_results jsonb not null,
  normalized_costs jsonb not null,
  risk jsonb not null,
  evidence_coverage jsonb not null,
  ranking jsonb not null,
  explanation text,
  engine_version text not null
);

-- ---------------------------------------------------------------------------
-- validator_findings: post-call unsupported-claim scanner output
-- ---------------------------------------------------------------------------
create table public.validator_findings (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.call_sessions(id),
  claim_text text not null,
  claim_type text not null check (claim_type in
    ('price', 'deadline', 'budget', 'availability', 'authority', 'flexibility')),
  transcript_ref jsonb not null,
  supported_by_tool_call boolean not null,
  supporting_tool_call jsonb,
  severity text not null check (severity in ('info', 'warning', 'violation')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- adversarial suite
-- ---------------------------------------------------------------------------
create table public.adversarial_scenarios (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category text not null,
  description text not null,
  setup jsonb not null,
  expected_outcome jsonb not null,
  created_at timestamptz not null default now()
);

create table public.adversarial_results (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.adversarial_scenarios(id),
  run_id uuid not null,
  run_at timestamptz not null default now(),
  passed boolean not null,
  details jsonb not null,
  call_id uuid references public.call_sessions(id)
);

create index adversarial_results_run_idx on public.adversarial_results (run_id);

-- ---------------------------------------------------------------------------
-- eval_runs: text-tier evaluation on held-out profiles
-- ---------------------------------------------------------------------------
create table public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('held_out_profiles')),
  config jsonb not null,
  results jsonb not null,
  run_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- replays: faithful re-render of a genuinely dynamic prior run
-- ---------------------------------------------------------------------------
create table public.replays (
  id uuid primary key default gen_random_uuid(),
  source_call_id uuid not null references public.call_sessions(id),
  label text not null,
  audio_url text,
  events jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security: enable everywhere, define NO policies.
-- anon and authenticated roles are denied all access; the server uses the
-- secret key (service_role, BYPASSRLS).
-- ---------------------------------------------------------------------------
alter table public.verticals enable row level security;
alter table public.job_specs enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_policies enable row level security;
alter table public.call_sessions enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;
alter table public.negotiation_events enable row level security;
alter table public.recommendations enable row level security;
alter table public.validator_findings enable row level security;
alter table public.adversarial_scenarios enable row level security;
alter table public.adversarial_results enable row level security;
alter table public.eval_runs enable row level security;
alter table public.replays enable row level security;

-- ---------------------------------------------------------------------------
-- Storage bucket for call audio (private; served via signed URLs)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('call-audio', 'call-audio', false)
on conflict (id) do nothing;
