# Tech video script — 55 seconds, screen only

Lead with the truth layer, not the stack. Five seconds maximum on the stack.

| t | screen | narration |
|---|---|---|
| 0–10 | `src/core/truth-layer.ts` — the six conditions | "The agent cannot invent competing bids — not because a prompt asks it nicely, but because the architecture never hands the model an unverified number. Its only path to a competing figure is this server tool: confirmed quote, matching job fingerprint, transcript evidence, not expired, compatible currency — or a typed error." |
| 10–18 | `buyer-tools.ts`: lever-gated tools appearing only when authorized | "Permissions work the same way. An unauthorized lever isn't discouraged — its tool simply doesn't exist for that session." |
| 18–26 | `data/supplier-policies/...json`: price sheet, floor, concession ladder | "Suppliers aren't scripts. Each runs a private price sheet, floor, and concession ladder; code enforces the floor and the ladder order. A price moves only when the buyer supplies a reason the policy accepts." |
| 26–34 | Board: evidence rail + click figure → transcript highlight; a voice-tier tape with audio | "Every fee is pinned to the second it was spoken. Same brain on voice: the ElevenLabs agent runs on our custom-LLM endpoint, so voice and text share one policy and one tool gate." |
| 34–42 | `price-engine.ts` + decision room breakdown | "Money is engine math: guaranteed cost, conditional exposure, refundable deposit separated from cost, tax, cash required. It caught the simulated dispatchers' own arithmetic slips live." |
| 42–52 | Evaluation lab: adversarial results with real pass/fail; validator findings | "Fifty-plus adversarial scenarios run against the real system — the score you see is the score we got. A post-call validator flags any commercial claim no tool supported." |
| 52–55 | `config/verticals/`: swap to moving-us | "Verticals are configuration. Next.js, Supabase, ElevenLabs, OpenAI pinned. That's the stack — the honesty is the product." |

Note: record section 42–52 only after the adversarial suite has real results.
