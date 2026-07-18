-- App settings (agent ids etc.) and voice-minute usage tracking.

create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Every ElevenLabs agent session we start is recorded here so the code can
-- enforce the voice budget (250 plan minutes) without trusting memory.
create table public.voice_usage (
  id uuid primary key default gen_random_uuid(),
  conversation_id text unique,
  kind text not null check (kind in ('intake', 'negotiation', 'verification')),
  seconds integer,
  created_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
alter table public.voice_usage enable row level security;
