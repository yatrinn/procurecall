# Video shot list

Recording setup for all screen material: 1920×1080, browser at 100 % zoom, incognito
window on https://procurecall.vercel.app, no bookmarks bar, cursor visible, no dev
tools. Record with system audio off; narrate separately or live per script.

## Demo video (screen only)

| # | shot | where | prep |
|---|---|---|---|
| D1 | Typed intake, submit | `/request`, "Type it" tab | Have the demo brief text ready to paste |
| D2 | Confirm screen scroll + confirm click, fingerprint chip appears | `/request/{id}` | Use a fresh spec so the confirm moment is real |
| D3 | Board with three tapes filling | `/board/{spec}` after "Call 3 suppliers" (or `/demo` replay if capacity is tight — then keep the replay label in frame) | Run once fully before recording |
| D4 | Close-up: leverage pin + connector + concession pin | same board | Zoom browser to 125 % for this shot only |
| D5 | Decision room: recommendation, evidence rail, figure click → transcript highlight | `/decision/{spec}` | Click a mid-list fee so the highlight scroll is visible |
| D6 | Flagged row with plain-words reasons | decision table | Hover the BW row |

## Tech video (screen only)

| # | shot | where |
|---|---|---|
| T1 | `src/core/truth-layer.ts` — conditions block | editor, font ≥ 14 pt |
| T2 | `src/negotiation/buyer-tools.ts` — lever-gated tool registration | editor |
| T3 | `data/supplier-policies/equipment-rental-stuttgart.json` — policy for supplier B | editor |
| T4 | Voice tape with audio player + pin click seeking audio | board with a voice call |
| T5 | `src/core/price-engine.ts` formula section | editor |
| T6 | Evaluation lab with REAL adversarial results | `/lab` (record after suite runs) |
| T7 | `src/config/verticals/` swap: rental → moving | editor + `/request` after swap |

## Team video

| # | shot | notes |
|---|---|---|
| P1 | Founder, full frame, eye level, natural light | Plain background, no logos; phone camera horizontal is fine |
| P2 | Optional 3-second cutaway to live demo on a second screen | Keep under 3 s; the ask is founder on camera |

## Assembly

- Hard cap: 60 s per video, target 55. Time each script read before recording.
- No music beds necessary; if used, keep −26 LUFS or lower under narration.
- Export H.264 MP4, 1080p. Name: `procurecall-demo.mp4`, `procurecall-tech.mp4`,
  `procurecall-team.mp4`.
