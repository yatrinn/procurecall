# ARCHITECTURE.md — ProcureCall

## System overview

```
                       ┌──────────────────────────────────────────────┐
                       │                Next.js on Vercel              │
                       │  App Router · TypeScript strict · Tailwind    │
                       │                                                │
  Browser ────────────▶│  UI: intake → confirm → live board → decision │
   │  (mic for voice)  │                                                │
   │                   │  Server routes (all secrets live here):        │
   │  ElevenLabs       │   /api/intake/*        spec extraction         │
   ├──WebRTC/WS───────▶│   /api/specs/*         confirm + fingerprint   │
   │  (voice intake &  │   /api/calls/*         orchestration, SSE/poll │
   │   buyer agent)    │   /api/tools/*         agent tool webhooks     │
   │                   │   /api/webhooks/elevenlabs   post-call ingest  │
   │                   │   /api/demo/*          seed + reset            │
                       └───────┬──────────────┬─────────────┬──────────┘
                               │              │             │
                     ┌─────────▼───┐   ┌──────▼─────┐  ┌────▼─────┐
                     │  Supabase   │   │ ElevenLabs │  │  OpenAI  │
                     │  Postgres   │   │  Agents    │  │  pinned  │
                     │  Storage    │   │  (voice)   │  │  model,  │
                     │  (audio)    │   │            │  │  strict  │
                     │  RLS: deny  │   └────────────┘  │  outputs │
                     │  anon; all  │                   └──────────┘
                     │  access via │   ┌────────────┐
                     │  server     │   │   Tavily   │  supplier research
                     └─────────────┘   └────────────┘  (labeled source)
```

Single Next.js app, deployed on Vercel. No other services. All provider keys and the
Supabase service-role key exist only in server routes. The browser talks to ElevenLabs
directly only for voice sessions (via short-lived tokens minted server-side).

## Core principle: the truth layer is architecture, not prompt

The buyer agent's only path to a competing figure is the server tool:

```ts
// server-only
getVerifiedLeverage({ currentSpecFingerprint, quoteId })
```

It returns a figure only when: quote status `confirmed` AND total non-null AND quote
fingerprint === current spec fingerprint AND ≥1 `transcript_ref` AND not expired AND
currency/tax basis compatible. Otherwise a typed error. Competing numbers are never in
the system prompt, conversation context, or knowledge base. The model cannot cite a
number it was never handed.

The same enforcement applies to authorized levers: an unauthorized lever's tool simply
does not exist on the agent's tool surface for that session.

A **post-call validator** scans every transcript for commercial claims (prices,
deadlines, budgets, availability, authority, flexibility) unsupported by a tool call and
surfaces violations in the evaluation lab.

## Negotiation core (transport-independent)

One negotiation policy, one tool surface, two execution tiers:

- **Text tier (default, all iteration):** buyer policy runs as an OpenAI loop with
  strict structured outputs; supplier policy runs as a separate stateful OpenAI loop
  with a private commercial policy (price sheet, floor, concession ladder, disclosure
  policy, behavioral profile). Turns are exchanged as text. Cost: $ cents.
- **Voice tier (verification, golden run, final demo):** buyer is an ElevenLabs
  Conversational Agent using the SAME server tools via webhooks. Supplier side stays a
  dynamic text-tier policy model whose replies are synthesized with ElevenLabs and
  routed into the conversation. Nothing is scripted or predetermined.

## Voice transport abstraction

```ts
interface CallTransport {
  mode: 'counter_agent' | 'human_roleplay' | 'real_phone' | 'verified_replay';
  start(session: CallSession): Promise<void>;
  events(): AsyncIterable<CallEvent>;   // transcript turns, tool calls, fee pins
  stop(reason: StopReason): Promise<void>;
}
```

- `counter_agent` — buyer vs. dynamic supplier policy (text tier or voice tier).
- `human_roleplay` — buyer voice agent vs. a human on the microphone.
- `real_phone` — **not built** (Twilio unconfigured). Hidden in UI.
- `verified_replay` — replays a genuinely dynamic prior run from persisted events +
  audio, always labeled as replay. Never synthesizes new content.

Hard limits enforced in code for every voice session: maximum call duration,
auto-hangup on silence, one retry maximum.

## Live board updates

Call events are persisted to Postgres as they happen (tool webhooks + transport
events). The live negotiation board polls light server endpoints (~1.5s interval) for
new events; no client-side Supabase access. Simple, robust on Vercel, demo-safe.

## Deterministic layer

- **Price engine:** pure TypeScript, unit-tested. Normalizes rate tiers to the exact
  request; separates guaranteed net cost, conditional cost, refundable deposit, tax,
  cash required; computes best/expected/worst case. No model involvement.
- **Ranking:** deterministic comparator producing rank + reason codes from hard
  constraints, normalized costs, risk, and evidence coverage. The model writes the
  plain-language explanation FROM the computed reason codes; it never chooses.
- **Fingerprint:** canonical JSON serialization of the confirmed spec (sorted keys,
  normalized values) → SHA-256. Any post-confirmation edit creates a new version with a
  new fingerprint. Server logic blocks calls until `confirmed_by_user` is true.

## Verticals as configuration

`config/verticals/*.ts` — spec taxonomy (fields, units, validation), benchmark table +
sources, red-flag rules, negotiation levers, supplier discovery templates, intake
interview outline. Two shipped: `equipment-rental-stuttgart` (primary),
`moving-us` (configuration proof). Swapping verticals swaps a config object, not code.

## Security posture

- RLS enabled on every table with deny-all policies; only the service-role key (server)
  reads/writes. The anon key is used for nothing sensitive.
- Uploaded document text is untrusted: parsed content is fenced, never interpolated
  into system instructions; extraction runs with a fixed schema and tool surface;
  prompt injection cannot alter instructions, tools, permissions, or schemas.
- Webhooks validated (ElevenLabs HMAC signature). Demo reset is rate-limited.
- No secret ever reaches the client bundle. `pnpm setup:check` reports presence only.

## Repository layout

```
app/                  routes (App Router)
  (product)/          intake, confirm, board, decision, lab
  demo/               public no-login demo
  api/                server routes: intake, specs, calls, tools, webhooks, demo
src/
  core/               schemas (Zod), fingerprint, price engine, ranking, truth layer
  negotiation/        buyer policy, supplier policy engine, tool surface
  transports/         counter_agent, human_roleplay, verified_replay
  integrations/       supabase, elevenlabs, openai, tavily (thin, documented clients)
  config/verticals/   equipment-rental-stuttgart, moving-us
supabase/migrations/  SQL migrations incl. RLS
data/                 fixtures, adversarial scenarios, eval results, rate-card refs
docs/                 INTEGRATION_NOTES.md and friends
submission/           summary, video scripts, shot list, dataset manifest, checklist
tests/                unit (Vitest) + e2e (Playwright)
```
