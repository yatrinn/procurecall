# DESIGN_SYSTEM.md — ProcureCall

The client has explicitly rejected anything that looks AI-generated. Hard requirement.

## Banned looks (disqualifying)

1. Warm cream ground (~#F4F1EA) + high-contrast serif display + terracotta accent
   (~#D97757).
2. Near-black ground + one bright acid-green or vermilion accent.
3. Broadsheet layout: hairline rules, zero radius, dense newspaper columns.

Also banned: purple/violet brand color, glassmorphism, neon gradients, floating blobs,
oversized pill buttons, robot imagery, chat-bubble-dominant layouts, generic dashboard
card grids.

## Grounding

Dispatch offices, machine spec plates, hi-vis site clothing, delivery notes,
time-stamped call logs. The product's own artifact: **a recorded phone call with
evidence pinned to it.** Every design decision comes from there.

## The signature — the Call Tape

The one memorable element; spend the boldness here, keep everything else quiet.

- Each supplier gets a horizontal **tape**: the audio waveform is the literal spine of
  the interface. Every extracted fee, disclosure, concession, and outcome is pinned to
  the tape at the second it was spoken.
- Comparison-table numbers each own a position on a tape. Clicking any figure anywhere
  scrubs that supplier's audio to the exact second and highlights the transcript turn.
- Decision view: a thin vertical **evidence rail** connects the recommended total down
  through its component fees to the tape moments that produced them.
- A verified leverage event renders as a link drawn between two tapes — the quote it
  came from and the call it was used in. That visual IS the truth layer.

A viewer with the sound off must understand what is happening.

## Tokens

```
--ground     #EDEFEA   cool paper. deliberately not cream
--ink        #14181A   primary text
--steel      #5A6570   secondary text, rules, inactive tape
--hivis      #C4D600   accent. site safety yellow-green. used sparingly
--verified   #0E5F55   deep petrol. ONLY on tool-verified evidence
--flag       #A8412F   muted brick. ONLY on red flags and failures
```

`--verified` on screen means exactly one thing: this number came from a verified tool
call. Never decorative — scarcity gives it meaning. Same discipline for `--flag`.

## Type

- Display: **Archivo Expanded 700** — very few, very large statements only.
- UI and body: **Instrument Sans**.
- All numbers, currency, timestamps, fingerprints, transcript references:
  **JetBrains Mono**. Monospaced numerals read as record, not marketing.

Loaded via `next/font`. Restrained scale. Sentence case throughout.

## Geometry and motion

- 4px radius everywhere.
- Generous whitespace around dense data; alignment carries structure, not borders.
- Motion only explains state change: a fee pin landing on the tape, a figure turning
  `--verified` on tool confirmation, a negotiation delta counting old → new. Fast,
  small, purposeful. Respect `prefers-reduced-motion`. No ambient animation.

## Copy

Written from the user's side of the screen. Specific and operational, never salesy.

- Good: `Three suppliers have not quoted delivery yet.`
- Bad: `Our intelligent AI seamlessly analyzes supplier quotes.`

Banned words: revolutionize, unlock, seamless, cutting-edge, game-changing, leverage
AI, intelligent solution, next-generation, powered by innovation.

Errors state what happened and what to do. Empty states invite an action. Buttons name
the thing that happens; the confirmation uses the same word.

## The three screens that must be exceptional

1. **Confirm request** — the spec, editable, lever authorizations, resolving into a
   fingerprint.
2. **Live negotiation board** — three tapes running in parallel, fees pinning in real
   time.
3. **Decision room** — ranked comparison with the evidence rail.

Everything else stays plain.

## Implementation notes

- Tokens as CSS custom properties in `globals.css`, mapped into Tailwind via
  `@theme` — single source of truth.
- Fonts: `next/font/google` — Archivo (700, `wdth` expanded axis), Instrument Sans,
  JetBrains Mono. `font-display: swap`.
- Tape rendered as SVG/canvas waveform with absolutely positioned pins; pins are
  buttons (keyboard reachable) with `aria-label` naming fee + timestamp.
- Screenshot critique against this file is required before continuing past the shell
  (AGENTS.md §14 step 7); findings recorded in STATUS.md.
