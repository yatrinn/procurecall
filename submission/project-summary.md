# ProcureCall — project summary

Phone-priced markets punish the person without time to call around. A site manager who
needs a 12-meter scissor lift on Monday at 07:00 would have to call six rental yards,
describe the same job six times, and compare quotes that are deliberately not
comparable. So he calls two and overpays. The prices are not hidden — they are simply
never written down.

ProcureCall is a buyer-side procurement agent built on ElevenLabs Agents. Intake by
voice interview or document upload produces one validated job spec; the user confirms
it and it freezes under a SHA-256 fingerprint that every call cites. The agent then
negotiates over live voice with suppliers that have genuinely distinct commercial
behavior — a transparent premium yard; a cheap-headline yard that opens with "79
euros a day" and discloses transport, insurance, deposit and surcharges only when
asked category by category, until the real total lands above 800 € net; and a hard
dispatcher who interrogates before naming any number. Nothing is scripted: each
simulated supplier runs a private price sheet, floor, and concession ladder grounded
in sourced public rate cards, enforced by code.

The differentiator is structural honesty. The buyer's only path to a competing figure
is a server-side verification tool that checks quote status, fingerprint match,
transcript evidence, expiry, and currency; unverified numbers never reach the model.
In the recorded run a quote fell from 895 € to 760 € net across the call — with the
decisive 90 € step (850 € → 760 €) coming the moment the agent cited a verified
competing quote. A deterministic engine computes every total and ranking with reason
codes — the model explains, it never chooses — and every figure in the decision room
links to the second of the call where it was spoken. A post-call validator flags any
claim no tool supported. Public demo, no login: https://procurecall.vercel.app/demo

*(Word count: ~270)*
