# INTEGRATION_NOTES.md

Key endpoints and payload shapes verified against official documentation before
implementation. Update this file whenever an integration is touched. Never store
credential values here.

## Supabase — new API key format (verified 2026-07-18)

Source: https://supabase.com/docs/guides/api/api-keys

- Two current key types: `sb_publishable_...` (browser-safe, maps to `anon` role /
  `authenticated` when a user JWT is present) and `sb_secret_...` (server-only, maps to
  `service_role`, BYPASSRLS). Legacy JWT `anon`/`service_role` keys still exist in this
  project but the new format is what `.env.local` uses.
- **Documented limitation:** you cannot send a publishable/secret key as
  `Authorization: Bearer ...`. Send it ONLY in the `apikey` header. (A Bearer copy that
  exactly equals `apikey` is forwarded but then rejected as a non-JWT.)
- Secret keys are rejected when used from a browser User-Agent (always 401).
- `GET {url}/rest/v1/` (OpenAPI spec) now requires a secret key on this project:
  publishable key gets 401 `"Secret API key required"`. Probe publishable-key access
  via a table path instead; PostgREST error `PGRST205` (table not found) still proves
  authentication succeeded.
- supabase-js: verify version supports new key format before use (step 6); pass the
  key as the second argument to `createClient` as usual.

### Environment incident log

- 2026-07-18: `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` contained the project ref
  (20 chars), not a key. Replaced silently with the project's `sb_secret_...` key via
  `npx supabase projects api-keys --project-ref <ref> --reveal --output json`
  (requires `--reveal`; without it the CLI returns masked values that LOOK like keys).
  No values were printed.

## ElevenLabs (verified 2026-07-18, more in step 9)

- `GET https://api.elevenlabs.io/v1/user/subscription` with header
  `xi-api-key: <key>` → 200. Account tier: creator, status active.
- Agents Platform docs to be read before step 8c/9: https://elevenlabs.io/docs/agents-platform
  (WebSocket/real-time page + post-call webhook page). Findings land here.

## OpenAI (verified 2026-07-18)

- `GET https://api.openai.com/v1/models` with `Authorization: Bearer <key>` → 200.
- Model pinning + strict structured outputs decided in step 8 after reading current
  docs (Responses API vs chat.completions — check `json_schema` strict mode support).

## Tavily (verified 2026-07-18)

- `POST https://api.tavily.com/search` with `Authorization: Bearer <key>` and JSON body
  `{ "query": string, "max_results": number }` → 200. Response contains `results[]`
  with `title`, `url`, `content`.

## Twilio

- Not configured (`TWILIO_PHONE_NUMBER` empty). Real phone mode is intentionally
  excluded from this build and hidden in the UI. No integration work planned.
