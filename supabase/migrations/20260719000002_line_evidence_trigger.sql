-- DB-level evidence guard: a quote line may only reference a transcript turn
-- that actually exists on its call. Complements the app-side checks.
create or replace function public.check_quote_line_evidence()
returns trigger
language plpgsql
as $$
declare
  turn_count integer;
  ref_turn integer;
begin
  if new.transcript_ref is null
     or not (new.transcript_ref ? 'call_id')
     or not (new.transcript_ref ? 'turn_index') then
    raise exception 'quote line requires a transcript_ref with call_id and turn_index';
  end if;

  ref_turn := (new.transcript_ref->>'turn_index')::integer;
  select jsonb_array_length(transcript) into turn_count
  from public.call_sessions where id = new.call_id;

  if turn_count is null then
    raise exception 'quote line references a call that does not exist';
  end if;
  if ref_turn < 0 or ref_turn >= turn_count then
    raise exception 'quote line references turn % but call % has only % turns',
      ref_turn, new.call_id, turn_count;
  end if;
  return new;
end;
$$;

drop trigger if exists quote_line_evidence on public.quote_lines;
create trigger quote_line_evidence
  before insert or update on public.quote_lines
  for each row execute function public.check_quote_line_evidence();
