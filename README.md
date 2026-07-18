# ProcureCall

*One brief. Every supplier. The best verified deal.*

Buyer-side AI procurement agent for phone-priced markets. Built for the Hack-Nation
6th Global AI Hackathon, Challenge 01 — The Negotiator (ElevenLabs).

> Build in progress. This README is completed at submission (screenshot, live demo
> link, product flow, truth layer, architecture, evaluation results, setup).

## What it does

A site manager needs a 12-meter electric scissor lift on Monday at 07:00. ProcureCall
takes the brief once — by voice interview or document upload — confirms a structured,
fingerprinted job spec, then calls the market: three suppliers with genuinely distinct
commercial behavior, no scripts. Every fee is extracted, itemized, and pinned to the
second of the recording where it was spoken. Hidden fees surface. Verified quotes
become negotiation leverage — the agent can only cite figures returned by a
server-side tool from confirmed, fingerprint-matched quotes. A deterministic price
engine and ranking produce an evidence-backed recommendation.

## Stack

Next.js (Vercel) · Supabase · ElevenLabs Agents · OpenAI (pinned, strict structured
outputs) · Tavily

## Documents

- [PLAN.md](./PLAN.md) — build plan and gates
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, truth layer
- [DATA_MODEL.md](./DATA_MODEL.md) — data contracts
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — the Call Tape
- [STATUS.md](./STATUS.md) — what works right now

## License

MIT
