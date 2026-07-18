import 'server-only';
import { supabaseAdmin } from '@/integrations/supabase-server';

/**
 * The truth layer. The buyer agent's ONLY path to a competing figure.
 *
 * Returns a verified figure when every condition holds; otherwise a typed
 * error. Competing numbers exist nowhere else: not in the system prompt,
 * not in the conversation context, not in any knowledge base. The model
 * cannot cite a number it was never handed.
 */

export type LeverageFailure =
  | 'quote_not_found'
  | 'quote_not_confirmed'
  | 'quote_total_missing'
  | 'fingerprint_mismatch'
  | 'no_transcript_evidence'
  | 'quote_expired'
  | 'currency_or_tax_incompatible';

export interface VerifiedLeverage {
  ok: true;
  supplier_name: string;
  quote_id: string;
  call_id: string;
  verified_total_cents: number;
  currency: string;
  tax_basis: string;
  evidence_transcript_ref: unknown;
  verified_at: string;
}

export interface LeverageError {
  ok: false;
  reason: LeverageFailure;
  detail: string;
}

export async function getVerifiedLeverage(input: {
  currentSpecFingerprint: string;
  quoteId: string;
  /** The requesting call's currency/tax context (from its vertical). */
  currency: string;
  taxBasis: string;
}): Promise<VerifiedLeverage | LeverageError> {
  const supabase = supabaseAdmin();

  const { data: quote, error } = await supabase
    .from('quotes')
    .select('id, call_id, supplier_id, spec_fingerprint, status, currency, tax_basis, validity_until, total_after_negotiation_cents, total_before_negotiation_cents')
    .eq('id', input.quoteId)
    .maybeSingle();
  if (error || !quote) {
    return { ok: false, reason: 'quote_not_found', detail: 'No such quote.' };
  }
  if (quote.status !== 'confirmed') {
    return {
      ok: false,
      reason: 'quote_not_confirmed',
      detail: `Quote status is '${quote.status}', not 'confirmed'.`,
    };
  }
  const total = quote.total_after_negotiation_cents ?? quote.total_before_negotiation_cents;
  if (total === null || total === undefined) {
    return { ok: false, reason: 'quote_total_missing', detail: 'Quote has no total.' };
  }
  if (quote.spec_fingerprint !== input.currentSpecFingerprint) {
    return {
      ok: false,
      reason: 'fingerprint_mismatch',
      detail: 'Quote was given for a different job specification.',
    };
  }
  const { count: lineCount } = await supabase
    .from('quote_lines')
    .select('*', { count: 'exact', head: true })
    .eq('quote_id', quote.id);
  if (!lineCount || lineCount === 0) {
    return {
      ok: false,
      reason: 'no_transcript_evidence',
      detail: 'Quote has no transcript-backed line items.',
    };
  }
  if (quote.validity_until && new Date(quote.validity_until).getTime() < Date.now()) {
    return { ok: false, reason: 'quote_expired', detail: 'Quote validity has lapsed.' };
  }
  if (quote.currency !== input.currency || quote.tax_basis !== input.taxBasis) {
    return {
      ok: false,
      reason: 'currency_or_tax_incompatible',
      detail: `Quote is ${quote.currency} ${quote.tax_basis}; current context is ${input.currency} ${input.taxBasis}.`,
    };
  }

  const { data: firstLine } = await supabase
    .from('quote_lines')
    .select('transcript_ref')
    .eq('quote_id', quote.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: supplier } = await supabase
    .from('suppliers')
    .select('name')
    .eq('id', quote.supplier_id)
    .single();

  return {
    ok: true,
    supplier_name: supplier?.name ?? 'Unknown supplier',
    quote_id: quote.id,
    call_id: quote.call_id,
    verified_total_cents: total,
    currency: quote.currency,
    tax_basis: quote.tax_basis,
    evidence_transcript_ref: firstLine?.transcript_ref ?? null,
    verified_at: new Date().toISOString(),
  };
}
