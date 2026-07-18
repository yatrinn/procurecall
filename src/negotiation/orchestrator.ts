import 'server-only';
import { supabaseAdmin } from '@/integrations/supabase-server';
import { getVertical } from '@/config/verticals';
import { getSpec, type SpecRow } from '@/core/specs-repo';
import { buyerSystemPrompt, generateBuyerTurn } from './buyer';
import { buildBuyerTools, type BuyerToolContext } from './buyer-tools';
import {
  applySupplierTurn,
  generateSupplierTurn,
  INITIAL_SUPPLIER_STATE,
  type SupplierPolicyRow,
  type SupplierState,
} from './supplier-engine';
import type { Outcome, QuoteLineArgs, ToolCallRecord, TranscriptTurn } from './types';
import { computeQuoteTotals } from '@/core/quote-pricing';
import type { VerticalConfig } from '@/config/vertical-schema';

/**
 * Text-tier call orchestration: buyer brain vs supplier policy engine.
 * The identical buyer brain drives the voice tier; only the transport differs.
 *
 * Hard limits: MAX_BUYER_TURNS and WALL_CLOCK_MS bound every call. Every call
 * ends in a structured outcome or an explicit failure_state.
 */

const MAX_BUYER_TURNS = 14;
const WALL_CLOCK_MS = 4 * 60_000;

export interface StartCallInput {
  specId: string;
  supplierId: string;
  transportMode?: 'counter_agent';
  tier?: 'text';
}

export async function startCall(input: StartCallInput): Promise<{ callId: string }> {
  const supabase = supabaseAdmin();
  const spec = await getSpec(input.specId);
  if (!spec) throw new Error('Spec not found');
  // The confirmation gate: server logic blocks all calls until confirmed.
  if (!spec.confirmed_by_user || !spec.spec_fingerprint) {
    throw new Error('This request is not confirmed. Confirm it before any supplier is called.');
  }
  const { data: supplier, error: supErr } = await supabase
    .from('suppliers')
    .select('id, name, vertical_slug')
    .eq('id', input.supplierId)
    .single();
  if (supErr || !supplier) throw new Error('Supplier not found');
  if (supplier.vertical_slug !== spec.vertical_slug) {
    throw new Error('Supplier does not serve this vertical.');
  }

  const { data: session, error } = await supabase
    .from('call_sessions')
    .insert({
      job_spec_id: spec.id,
      supplier_id: supplier.id,
      transport_mode: input.transportMode ?? 'counter_agent',
      tier: input.tier ?? 'text',
      status: 'pending',
      spec_fingerprint: spec.spec_fingerprint,
      supplier_state: INITIAL_SUPPLIER_STATE,
    })
    .select('id')
    .single();
  if (error) throw new Error(`call session insert failed: ${error.message}`);
  return { callId: session.id };
}

interface SessionRow {
  id: string;
  job_spec_id: string;
  supplier_id: string;
  status: string;
  transcript: TranscriptTurn[];
  tool_calls: ToolCallRecord[];
  supplier_state: SupplierState;
  spec_fingerprint: string;
}

export async function runTextCall(callId: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { data: sessionData, error: sesErr } = await supabase
    .from('call_sessions')
    .select('id, job_spec_id, supplier_id, status, transcript, tool_calls, supplier_state, spec_fingerprint')
    .eq('id', callId)
    .single();
  if (sesErr || !sessionData) throw new Error('Call session not found');
  const session = sessionData as unknown as SessionRow;
  if (session.status !== 'pending') throw new Error(`Call is ${session.status}, not pending`);

  const spec = (await getSpec(session.job_spec_id)) as SpecRow;
  const vertical = getVertical(spec.vertical_slug);

  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('id', session.supplier_id)
    .single();
  const { data: policyRow } = await supabase
    .from('supplier_policies')
    .select('behavior_profile, price_sheet, floor, concession_ladder, disclosure_policy')
    .eq('supplier_id', session.supplier_id)
    .single();
  if (!supplier || !policyRow) throw new Error('Supplier or policy missing');
  const policy = policyRow as unknown as SupplierPolicyRow;

  const startedAt = Date.now();
  const transcript: TranscriptTurn[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const loggedLines: Array<QuoteLineArgs & { turn_index: number }> = [];
  const frictionEvents: Array<{ turn_index: number; kind: string; note: string }> = [];
  let outcome: Outcome | null = null;
  let supplierState: SupplierState = session.supplier_state ?? INITIAL_SUPPLIER_STATE;
  let disclosureEvent: { turn_index: number; text: string } | null = null;
  let failureState: string | null = null;
  let buyerResponseId: string | null = null;

  let turnCounter = 0;
  const nowMs = () => Date.now() - startedAt;

  const record = (r: ToolCallRecord) => {
    toolCalls.push(r);
    const result = r.result as { logged?: boolean; line?: QuoteLineArgs; ended?: boolean; outcome?: Outcome; recorded?: boolean; kind?: string; note?: string };
    if (r.tool === 'log_quote_line' && result.logged && result.line) {
      loggedLines.push({ ...result.line, turn_index: r.turn_index });
    }
    if (r.tool === 'record_outcome' && result.ended && result.outcome) {
      outcome = result.outcome;
    }
    if (r.tool === 'record_friction' && result.recorded) {
      frictionEvents.push({
        turn_index: r.turn_index,
        kind: result.kind ?? 'other',
        note: result.note ?? '',
      });
    }
  };

  const toolCtx: BuyerToolContext = {
    callId,
    specId: spec.id,
    specFingerprint: session.spec_fingerprint,
    supplierId: session.supplier_id,
    vertical,
    levers: spec.authorized_levers,
    budgetNet: (spec.spec.fields as { budget_net?: number | null }).budget_net ?? null,
    currentTurnIndex: () => turnCounter,
    nowMs,
  };
  const tools = buildBuyerTools(toolCtx);
  const systemPrompt = buyerSystemPrompt({
    vertical,
    fields: spec.spec.fields,
    fingerprint: session.spec_fingerprint,
    supplierName: supplier.name,
    levers: spec.authorized_levers,
  });

  const persist = async (status: 'in_progress' | 'completed' | 'failed') => {
    await supabase
      .from('call_sessions')
      .update({
        status,
        transcript,
        tool_calls: toolCalls,
        supplier_state: supplierState,
        friction_events: frictionEvents,
        disclosure_event: disclosureEvent,
        outcome,
        outcome_type: outcome ? (outcome as Outcome).type : null,
        failure_state: failureState,
        buyer_response_id: buyerResponseId,
        started_at: new Date(startedAt).toISOString(),
        ended_at: status === 'in_progress' ? null : new Date().toISOString(),
      })
      .eq('id', callId);
  };

  await persist('in_progress');

  try {
    // Supplier opens the call (they answer the phone).
    const greeting = `${supplier.name}, hello?`;
    transcript.push({ turn_index: turnCounter++, role: 'supplier', message: greeting, at_ms: nowMs() });
    await persist('in_progress');
    let latestSupplierMessage = greeting;

    for (let buyerTurns = 0; buyerTurns < MAX_BUYER_TURNS; buyerTurns++) {
      if (Date.now() - startedAt > WALL_CLOCK_MS) {
        failureState = 'wall_clock_exceeded';
        break;
      }

      const buyerTurn = await generateBuyerTurn({
        systemPrompt,
        previousResponseId: buyerResponseId,
        supplierMessage: latestSupplierMessage,
        tools,
        record,
        turnIndex: turnCounter,
        nowMs,
      });
      buyerResponseId = buyerTurn.responseId;

      if (buyerTurn.message) {
        const idx = turnCounter++;
        transcript.push({ turn_index: idx, role: 'buyer', message: buyerTurn.message, at_ms: nowMs() });
        if (!disclosureEvent && /\bAI\b|automated|assistant/i.test(buyerTurn.message)) {
          disclosureEvent = { turn_index: idx, text: buyerTurn.message };
        }
        await persist('in_progress');
      }
      if (buyerTurn.endedByOutcome || outcome) break;
      if (!buyerTurn.message) {
        failureState = 'buyer_no_message';
        break;
      }

      const supplierTurn = await generateSupplierTurn({
        supplierName: supplier.name,
        policy,
        state: supplierState,
        transcript,
      });
      supplierState = applySupplierTurn(supplierState, supplierTurn);
      transcript.push({
        turn_index: turnCounter++,
        role: 'supplier',
        message: supplierTurn.message,
        at_ms: nowMs(),
      });
      latestSupplierMessage = supplierTurn.message;
      await persist('in_progress');

      if (supplierState.hangup) {
        frictionEvents.push({ turn_index: turnCounter - 1, kind: 'hangup', note: 'Supplier ended the call.' });
        // Give the buyer one wrap-up turn to record the structured outcome.
        const wrap = await generateBuyerTurn({
          systemPrompt,
          previousResponseId: buyerResponseId,
          supplierMessage:
            '[SYSTEM NOTE — not the supplier: the supplier hung up. Record the structured outcome now via record_outcome (callback commitment if one was offered, otherwise documented decline). No further speech.]',
          tools,
          record,
          turnIndex: turnCounter,
          nowMs,
        });
        buyerResponseId = wrap.responseId;
        break;
      }
    }

    if (!outcome && !failureState) failureState = 'max_turns_without_outcome';

    // A call that ends without a model-recorded outcome gets an explicit
    // documented outcome from the orchestrator — structural facts only.
    if (!outcome) {
      outcome = {
        type: 'documented_decline',
        summary:
          failureState === 'wall_clock_exceeded' || failureState === 'max_turns_without_outcome'
            ? 'Call ended by system limit before a complete quote was captured.'
            : 'Call ended without a structured outcome.',
        supplier_confirmed_total: null,
        total_net_cents: null,
        availability_confirmed: null,
        validity_days: null,
        callback_when: null,
        decline_reason: failureState,
      };
    }

    await persistQuote({
      callId,
      spec,
      supplierId: session.supplier_id,
      vertical,
      outcome,
      loggedLines,
    });

    await persist('completed');

    // Post-call validator runs after completion; a validator failure must
    // never corrupt the call result itself.
    try {
      const { runPostCallValidator } = await import('@/core/validator');
      await runPostCallValidator(callId);
    } catch (e) {
      console.error('post-call validator failed:', e);
    }
  } catch (e) {
    failureState = e instanceof Error ? e.message : 'unknown_error';
    if (!outcome) {
      outcome = {
        type: 'documented_decline',
        summary: 'Call failed with a technical error before completion.',
        supplier_confirmed_total: null,
        total_net_cents: null,
        availability_confirmed: null,
        validity_days: null,
        callback_when: null,
        decline_reason: 'technical_error',
      };
    }
    await persist('failed');
    throw e;
  }
}

async function persistQuote(input: {
  callId: string;
  spec: SpecRow;
  supplierId: string;
  vertical: VerticalConfig;
  outcome: Outcome;
  loggedLines: Array<QuoteLineArgs & { turn_index: number }>;
}): Promise<void> {
  if (input.outcome.type !== 'quote') return;
  const supabase = supabaseAdmin();

  const confirmed =
    input.outcome.supplier_confirmed_total === true &&
    input.outcome.availability_confirmed === true &&
    input.outcome.total_net_cents !== null &&
    input.loggedLines.length > 0;

  const validityUntil = input.outcome.validity_days
    ? new Date(Date.now() + input.outcome.validity_days * 86_400_000).toISOString()
    : null;

  // Deterministic pricing: engine totals are authoritative, cross-checked
  // against the read-back total from the call.
  const { data: eventRows } = await supabase
    .from('negotiation_events')
    .select('event_type, concession_type, amount_before_cents, amount_after_cents')
    .eq('call_id', input.callId)
    .in('event_type', ['concession', 'fee_waived', 'fee_reduced', 'rate_reduced']);

  const totals = computeQuoteTotals({
    vertical: input.vertical,
    fields: input.spec.spec.fields,
    lines: input.loggedLines,
    concessions: (eventRows ?? []).map((e) => ({
      category_hint: e.concession_type,
      amount_before_cents: e.amount_before_cents,
      amount_after_cents: e.amount_after_cents,
    })),
    modelClaimedTotalCents: input.outcome.total_net_cents,
  });

  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      call_id: input.callId,
      supplier_id: input.supplierId,
      job_spec_id: input.spec.id,
      spec_fingerprint: input.spec.spec_fingerprint,
      availability_status: input.outcome.availability_confirmed ? 'confirmed' : 'unconfirmed',
      validity_until: validityUntil,
      total_before_negotiation_cents: totals.totalBeforeCents,
      total_after_negotiation_cents: totals.totalAfterCents,
      status: confirmed && !totals.engineDisagreesWithModel ? 'confirmed' : 'draft',
      currency: input.vertical.currency,
      tax_basis: 'net',
      vat_rate: input.vertical.vatRate,
      price_breakdown: totals.breakdown,
      is_benchmark_outlier: totals.breakdown.is_benchmark_outlier,
      missing_information: totals.breakdown.unknown_categories,
    })
    .select('id')
    .single();
  if (error) throw new Error(`quote insert failed: ${error.message}`);

  if (input.loggedLines.length > 0) {
    const rows = input.loggedLines.map((line) => ({
      quote_id: quote.id,
      call_id: input.callId,
      label: line.label,
      amount_cents: line.amount_cents,
      unit: line.unit,
      is_mandatory: line.is_mandatory,
      is_conditional: line.is_conditional,
      condition_trigger: line.condition_trigger,
      category: line.category,
      transcript_ref: { call_id: input.callId, turn_index: line.turn_index },
    }));
    const { error: lineErr } = await supabase.from('quote_lines').insert(rows);
    if (lineErr) throw new Error(`quote lines insert failed: ${lineErr.message}`);
  }
}
