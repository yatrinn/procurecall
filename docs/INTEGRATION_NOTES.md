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
- supabase-js `2.110.7` (requires Node ≥22): **verified working with `sb_secret_` keys**
  server-side — seed script performed upserts successfully. `createClient(url, key)`
  with `auth: { persistSession: false, autoRefreshToken: false }` for server use.
- RLS posture verified empirically: with tables under RLS and zero policies, the
  publishable key gets `[]` on select and error `42501` on insert; the secret key has
  full access. All app data access goes through server routes.
- Migrations applied with `npx supabase db push --password "$SUPABASE_DB_PASSWORD"`
  (project linked via `npx supabase link`). A Docker warning about the migrations
  catalog cache is harmless for remote pushes.

### Environment incident log

- 2026-07-18: `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` contained the project ref
  (20 chars), not a key. Replaced silently with the project's `sb_secret_...` key via
  `npx supabase projects api-keys --project-ref <ref> --reveal --output json`
  (requires `--reveal`; without it the CLI returns masked values that LOOK like keys).
  No values were printed.

## ElevenLabs (docs read 2026-07-18: quickstart, webhook tools, post-call webhooks, WebSocket, React SDK, agents-create API schema)

Base: `https://api.elevenlabs.io`, auth header `xi-api-key: <key>`. Docs pages: append
`.md` for markdown; section index at `/docs/eleven-agents/llms.txt`.

- Subscription check: `GET /v1/user/subscription` → 200, tier creator, active.
- **SDKs:** server `@elevenlabs/elevenlabs-js` (client `elevenlabs.conversationalAi.*`),
  browser `@elevenlabs/react` (`ConversationProvider` + `useConversation`;
  `startSession({ signedUrl | conversationToken | agentId })` → `conversationId`;
  callbacks `onMessage`, `onModeChange`, `onStatusChange`, `onAgentChatResponsePart`;
  `textOnly` mode exists; voice uses WebRTC by default, text uses WebSocket).
- **Create/update agent:** `conversationalAi.agents.create({ name, tags,
  conversationConfig })`, `agents.update(agentId, {...})`. Key config paths
  (snake_case on wire; SDK accepts camelCase):
  - `conversation_config.agent.first_message`, `.agent.language`,
    `.agent.prompt.prompt`, `.agent.prompt.llm`, `.agent.prompt.tool_ids`
  - `conversation_config.agent.prompt.custom_llm`: `{ url, model_id, api_key
    {secret_id|env_var_label}, api_type: 'chat_completions' | 'responses' }` — an
    OpenAI-compatible endpoint URL; used when llm = 'CUSTOM_LLM'
  - `conversation_config.conversation.max_duration_seconds` (default 600) — hard cap
  - `conversation_config.conversation.text_only: true` — "audio will not be processed
    and only text will be used, use to avoid audio pricing" (text-tier lever)
  - `conversation_config.turn.turn_timeout` (default 7 s),
    `.turn.silence_end_call_timeout` (default -1 = off; set to hang up on silence)
  - `platform_settings.auth.enable_auth` — private agent, sessions require signed URL
- **Signed URL (server-side, key never in browser):**
  `GET /v1/convai/conversation/get-signed-url?agent_id=...` → `{ signed_url }`. WebRTC
  token variant: `GET /v1/convai/conversation/token?agent_id=...` → `{ token }`.
- **Webhook tools:** `conversationalAi.tools.create({ toolConfig: { type: 'webhook',
  name, description, api_schema: { url, method, path_params_schema,
  body_params_schema... } } })`, then reference via `prompt.tool_ids`. (We mostly do
  NOT need these: the buyer brain runs as OUR custom LLM and executes tools
  server-side, which is the truth-layer enforcement point.)
- **Post-call webhooks:** workspace-level setting (dashboard) with HMAC
  (`ElevenLabs-Signature`, `elevenlabs.webhooks.constructEvent(rawBody, sig, secret)`).
  Types: `post_call_transcription` (full transcript incl. `tool_calls`,
  `tool_results`, `time_in_call_secs` per turn, `metadata` with costs/duration),
  `post_call_audio` (base64 MP3 in `data.full_audio`), `call_initiation_failure`.
  **Decision: PULL instead of webhooks** to avoid dashboard-only setup — after a
  session ends we fetch `GET /v1/convai/conversations/{conversation_id}` (transcript,
  status) and `GET /v1/convai/conversations/{conversation_id}/audio` (recording),
  with retry until analysis is done. Webhooks can be added later without code changes
  elsewhere.
- **Raw WebSocket** (if needed for audio routing): `wss://api.elevenlabs.io/v1/convai/
  conversation?agent_id=...` (or signed URL); client sends
  `{ user_audio_chunk: <base64> }`, `{ type: 'contextual_update', text }`, pong replies;
  receives `user_transcript`, `agent_response`, `audio` (base64 chunks + alignment),
  `interruption`, `ping`, `agent_chat_response_part`.
- **Simulate-conversation API is deprecated** (replaced by agent-testing endpoints).
  Not needed: our text tier runs our own buyer-policy loop against our supplier engine
  directly via OpenAI — zero ElevenLabs minutes.

### Voice verification log

- 2026-07-19 ~01:40: intake agent smoke test over raw WebSocket — signed URL ok,
  `conversation_initiation_client_data` with `dynamic_variables` accepted, agent
  produced first message text + TTS audio. Cost ~2 s (booked in voice_usage,
  kind=verification). Conversation `conv_8101kxvsb62wem0rnhckzkftspnr`.
- 2026-07-19 ~01:45: buyer voice agent created with `llm: 'custom-llm'` (SDK enum;
  REST shows CUSTOM_LLM elsewhere — the SDK value is lowercase-hyphen), custom LLM
  `url: <prod>/api/llm/v1`, `api_key: { secretId }` (workspace secret via
  `POST /v1/convai/secrets` — requires `type: 'new'` in the body),
  `request_headers: { 'x-call-id': { variable_name: 'call_id' } }` (dynamic variable
  per session). Production smoke: authorized SSE chat-completions stream with buyer
  disclosure line. 0 voice seconds consumed (no agent session started).

### Voice architecture decisions (budget: 250 agent minutes total)

- One negotiation brain, two transports. The buyer policy is OUR server code (OpenAI
  pinned model + server-side tools = truth layer). Text tier: plain loop, no
  ElevenLabs. Voice tier: ElevenLabs agent whose LLM is our custom-LLM endpoint
  (`/api/llm/v1/chat/completions`), so voice and text tiers share the identical
  policy and tool gating.
- Supplier side never runs as a second ElevenLabs agent (would double minute burn).
  Supplier policy = dynamic stateful model; in voice mode its turns are synthesized
  via ElevenLabs TTS and routed into the buyer agent session as user audio (honest
  fallback per AGENTS.md §9).
- Intake agent: standard ElevenLabs agent (hosted LLM), private (`enable_auth`),
  browser sessions via signed URL. Transcript pulled after session; extraction into
  JobSpec reuses the document-intake extraction path.
- Budget guards in code: `max_duration_seconds` 180 (intake) / 240 (negotiation),
  `silence_end_call_timeout` ~15 s, server-side session gate that refuses to mint a
  signed URL when the remaining subscription quota is low, voice reserved for loop
  verification + golden run + final demo.

## OpenAI (verified 2026-07-18)

- `GET https://api.openai.com/v1/models` with `Authorization: Bearer <key>` → 200.
- **Pinned models** (dated snapshots available on this key, chosen for reproducibility):
  - Reasoning / extraction / buyer negotiation: `gpt-5.5-2026-04-23`
  - Cheap roles (supplier simulation turns, validator scans): `gpt-5.4-mini-2026-03-17`
- **Structured outputs** (docs: /docs/guides/structured-outputs): use the Responses API.
  - SDK: `openai` 6.48.0. `client.responses.parse({ model, input, text: { format:
    zodTextFormat(schema, 'name') } })` with `import { zodTextFormat } from
    'openai/helpers/zod'`.
  - Strict schema rules: all fields required (use `.nullable()` instead of optional),
    refusals surface as `content` item `type: 'refusal'` — must be handled.
  - Function calling variant used for the negotiation tool surface; text.format for
    user-facing structured replies.
- **File inputs** (docs: /docs/guides/pdf-files): Responses API `input_file` content
  part. PDFs: base64 `file_data: 'data:application/pdf;base64,...'` + `filename`, model
  receives text + page images (vision models). Images go as `input_image` data URLs.
  50 MB combined per-request limit. Upload purpose `user_data` if using Files API.

## Tavily (verified 2026-07-18)

- `POST https://api.tavily.com/search` with `Authorization: Bearer <key>` and JSON body
  `{ "query": string, "max_results": number }` → 200. Response contains `results[]`
  with `title`, `url`, `content`.

## Twilio

- Not configured (`TWILIO_PHONE_NUMBER` empty). Real phone mode is intentionally
  excluded from this build and hidden in the UI. No integration work planned.
