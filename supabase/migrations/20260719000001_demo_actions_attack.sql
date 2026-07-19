-- Allow the lab's interactive truth-layer console in the rate-limit ledger.
alter table public.demo_actions
  drop constraint demo_actions_action_check;
alter table public.demo_actions
  add constraint demo_actions_action_check
  check (action in ('run', 'reset', 'attack'));
