import 'server-only';
import OpenAI from 'openai';

/**
 * Pinned model snapshots (docs/INTEGRATION_NOTES.md). Never use floating
 * aliases in app code — reproducibility is part of the product's claim.
 */
export const MODELS = {
  /** Extraction, text-tier buyer negotiation, heavy reasoning. */
  reasoning: 'gpt-5.5-2026-04-23',
  /**
   * Voice spoken reply (no tools). gpt-5.4 is fast enough for ~1–2s phone
   * turns and sharp enough to sound like a competent buyer. Speech runs in
   * parallel with tool logging so the line is never waiting on fee writes.
   */
  voiceSpeak: 'gpt-5.4-2026-03-05',
  /** Voice silent tool logging (fees, outcome) — parallel to speech. */
  voiceTools: 'gpt-5.4-2026-03-05',
  /** @deprecated alias — prefer voiceSpeak */
  voice: 'gpt-5.4-2026-03-05',
  /** Supplier simulation turns, validator scans, cheap classification. */
  fast: 'gpt-5.4-mini-2026-03-17',
} as const;

let cached: OpenAI | null = null;

export function openai(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  cached = new OpenAI({ apiKey });
  return cached;
}
