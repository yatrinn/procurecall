import type { TapePin, TapeTurn } from './call-tape';

/**
 * Pure derivation of tape pins from persisted call data. Used by the live
 * board and the verified replay so both render identical evidence.
 */

export interface PinSourceSession {
  id: string;
  transcript: TapeTurn[];
  tool_calls: Array<{
    turn_index: number;
    tool: string;
    at_ms: number;
    result: {
      logged?: boolean;
      line?: {
        label?: string;
        amount_cents?: number;
        unit?: string;
        is_conditional?: boolean;
      };
    };
  }>;
  friction_events: Array<{ turn_index: number; kind: string; note: string }> | null;
  disclosure_event: { turn_index: number } | null;
  outcome_type: string | null;
}

export interface PinSourceEvent {
  id: string;
  call_id: string;
  event_type: string;
  concession_type: string | null;
  amount_before_cents: number | null;
  amount_after_cents: number | null;
  transcript_ref: { turn_index?: number } | null;
}

export function derivePins(session: PinSourceSession, events: PinSourceEvent[]): TapePin[] {
  const turnAt = (turnIndex: number) =>
    session.transcript.find((t) => t.turn_index === turnIndex);
  const result: TapePin[] = [];

  for (const tc of session.tool_calls) {
    if (tc.tool === 'log_quote_line' && tc.result.logged && tc.result.line) {
      const line = tc.result.line;
      result.push({
        id: `line-${session.id}-${tc.at_ms}-${line.label}`,
        at_ms: tc.at_ms,
        turn_index: tc.turn_index,
        kind: line.is_conditional ? 'conditional_fee' : 'fee',
        label: line.label ?? 'fee',
        amount_label:
          line.unit === 'percent_of_rental'
            ? `${((line.amount_cents ?? 0) / 100).toFixed(1)}%`
            : `${(((line.amount_cents ?? 0) as number) / 100).toFixed(0)}€${line.unit === 'per_day' ? '/d' : ''}`,
        audio_start_s: turnAt(tc.turn_index)?.audio_start_s ?? null,
      });
    }
  }
  for (const ev of events) {
    if (ev.call_id !== session.id) continue;
    const turnIndex = ev.transcript_ref?.turn_index ?? 0;
    if (ev.event_type === 'leverage_used') {
      result.push({
        id: `leverage-${ev.id}`,
        at_ms: turnAt(turnIndex)?.at_ms ?? 0,
        turn_index: turnIndex,
        kind: 'leverage',
        label: 'verified leverage',
      });
    } else if (['concession', 'fee_waived', 'fee_reduced', 'rate_reduced'].includes(ev.event_type)) {
      const delta =
        ev.amount_before_cents !== null && ev.amount_after_cents !== null
          ? `−${((ev.amount_before_cents - ev.amount_after_cents) / 100).toFixed(0)}€`
          : '';
      result.push({
        id: `concession-${ev.id}`,
        at_ms: turnAt(turnIndex)?.at_ms ?? 0,
        turn_index: turnIndex,
        kind: 'concession',
        label: ev.concession_type ?? ev.event_type,
        amount_label: delta,
      });
    }
  }
  if (session.disclosure_event) {
    const t = turnAt(session.disclosure_event.turn_index);
    result.push({
      id: `disclosure-${session.id}`,
      at_ms: t?.at_ms ?? 0,
      turn_index: session.disclosure_event.turn_index,
      kind: 'disclosure',
      label: 'AI disclosed',
    });
  }
  for (const f of session.friction_events ?? []) {
    const t = turnAt(f.turn_index);
    result.push({
      id: `friction-${session.id}-${f.turn_index}-${f.kind}`,
      at_ms: t?.at_ms ?? 0,
      turn_index: f.turn_index,
      kind: 'friction',
      label: f.kind.replaceAll('_', ' '),
    });
  }
  if (session.outcome_type) {
    const lastTurn = session.transcript[session.transcript.length - 1];
    result.push({
      id: `outcome-${session.id}`,
      at_ms: lastTurn?.at_ms ?? 0,
      turn_index: lastTurn?.turn_index ?? 0,
      kind: 'outcome',
      label: session.outcome_type.replaceAll('_', ' '),
    });
  }
  return result;
}
