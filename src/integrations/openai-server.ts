import 'server-only';
import OpenAI from 'openai';

/**
 * Pinned model snapshots (docs/INTEGRATION_NOTES.md). Never use floating
 * aliases in app code — reproducibility is part of the product's claim.
 */
export const MODELS = {
  /** Extraction, buyer negotiation, explanations. */
  reasoning: 'gpt-5.5-2026-04-23',
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
