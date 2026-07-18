-- OpenAI Responses API conversation chaining for the buyer brain. Lets the
-- voice tier continue the same conversation across requests.
alter table public.call_sessions
  add column buyer_response_id text;
