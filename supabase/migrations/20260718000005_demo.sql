-- Public demo support: visitor-run marking and simple rate limiting.

alter table public.job_specs
  add column is_demo_run boolean not null default false;

create table public.demo_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('run', 'reset')),
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index demo_actions_recent_idx on public.demo_actions (action, created_at);

alter table public.demo_actions enable row level security;
