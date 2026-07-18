-- Private per-call supplier engine state (consumed concession steps, disclosed
-- categories). Never selected by any client-facing endpoint.
alter table public.call_sessions
  add column supplier_state jsonb not null default '{}'::jsonb;
