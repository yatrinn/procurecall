'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { PrimaryButton } from '@/components/form';

/**
 * Live negotiation board (functional version). Step 13 turns this into the
 * Call Tape visual; the data flow is already final: poll board state, pin
 * fees as they are logged, show structured outcomes.
 */

interface TranscriptTurn {
  turn_index: number;
  role: 'buyer' | 'supplier';
  message: string;
  at_ms: number;
}

interface ToolCallRecord {
  turn_index: number;
  tool: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  at_ms: number;
}

interface SessionDto {
  id: string;
  supplier_id: string;
  status: string;
  outcome_type: string | null;
  outcome: { summary?: string; total_net_cents?: number | null } | null;
  failure_state: string | null;
  transcript: TranscriptTurn[];
  tool_calls: ToolCallRecord[];
  disclosure_event: { turn_index: number } | null;
  spec_fingerprint: string;
}

interface QuoteDto {
  id: string;
  call_id: string;
  supplier_id: string;
  status: string;
  total_after_negotiation_cents: number | null;
  availability_status: string | null;
}

interface SupplierDto {
  id: string;
  name: string;
  location: string | null;
  is_simulated: boolean;
}

interface BoardState {
  sessions: SessionDto[];
  quotes: QuoteDto[];
  suppliers: SupplierDto[];
  events: Array<{ call_id: string; event_type: string; concession_type: string | null }>;
}

function eur(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `${(cents / 100).toFixed(2)} EUR`;
}

export function BoardClient({
  specId,
  supplierIds,
}: {
  specId: string;
  supplierIds: string[];
}) {
  const [state, setState] = useState<BoardState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/specs/${specId}/board`, { cache: 'no-store' });
    if (res.ok) setState((await res.json()) as BoardState);
  }, [specId]);

  useEffect(() => {
    const kickoff = setTimeout(() => void refresh(), 0);
    pollRef.current = setInterval(() => void refresh(), 1500);
    return () => {
      clearTimeout(kickoff);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const startCalls = useCallback(async () => {
    setStarting(true);
    setError(null);
    const results = await Promise.allSettled(
      supplierIds.map((supplierId) =>
        fetch('/api/calls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spec_id: specId, supplier_id: supplierId }),
        }).then(async (r) => {
          if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? 'failed');
        }),
      ),
    );
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      setError(
        `${failures.length} of ${supplierIds.length} calls failed to complete. The board shows everything that was captured.`,
      );
    }
    setStarting(false);
    void refresh();
  }, [specId, supplierIds, refresh]);

  const hasSessions = (state?.sessions.length ?? 0) > 0;
  const allDone =
    hasSessions && (state?.sessions ?? []).every((s) => s.status === 'completed' || s.status === 'failed');

  const supplierName = useMemo(() => {
    const map = new Map<string, SupplierDto>();
    for (const s of state?.suppliers ?? []) map.set(s.id, s);
    return (id: string) => map.get(id);
  }, [state?.suppliers]);

  return (
    <div>
      <div className="flex items-center gap-4">
        {!hasSessions ? (
          <>
            <PrimaryButton onClick={startCalls} disabled={starting}>
              {starting ? 'Calling the market…' : `Call ${supplierIds.length} suppliers`}
            </PrimaryButton>
            <span className="text-sm text-steel">
              Text-tier negotiation — same brain, same tools as the voice tier.
            </span>
          </>
        ) : null}
        {allDone ? (
          <Link
            href={`/decision/${specId}`}
            className="rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-black"
          >
            Open decision room
          </Link>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-flag">{error}</p> : null}

      <div className="mt-8 space-y-10">
        {(state?.sessions ?? []).map((session) => {
          const supplier = supplierName(session.supplier_id);
          const quote = state?.quotes.find((q) => q.call_id === session.id);
          const pins = session.tool_calls.filter((t) => t.tool === 'log_quote_line');
          const lastTurn = session.transcript[session.transcript.length - 1];
          return (
            <section key={session.id} className="border-t border-line pt-4">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="font-medium">{supplier?.name ?? 'Supplier'}</h2>
                <span className="text-xs text-steel">
                  {supplier?.is_simulated ? 'simulated supplier' : 'live'} ·{' '}
                  {supplier?.location ?? ''}
                </span>
                <span className="figure ml-auto text-xs text-steel">
                  fingerprint {session.spec_fingerprint.slice(0, 12)}
                </span>
                <StatusBadge session={session} />
              </div>

              {pins.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {pins.map((pin, i) => {
                    const line = (pin.result as { line?: { label?: string; amount_cents?: number; is_conditional?: boolean; unit?: string } }).line;
                    if (!line) return null;
                    return (
                      <li
                        key={i}
                        className={`rounded-sm border px-2 py-1 text-xs ${
                          line.is_conditional
                            ? 'border-line text-steel'
                            : 'border-steel text-ink'
                        }`}
                      >
                        <span>{line.label}</span>{' '}
                        <span className="figure">
                          {line.unit === 'percent_of_rental'
                            ? `${((line.amount_cents ?? 0) / 100).toFixed(1)}%`
                            : eur(line.amount_cents)}
                          {line.unit === 'per_day' ? '/day' : ''}
                        </span>
                        {line.is_conditional ? ' if triggered' : ''}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {session.status === 'in_progress' && lastTurn ? (
                <p className="mt-3 text-sm text-steel">
                  <span className="text-ink">{lastTurn.role === 'buyer' ? 'Agent' : 'Dispatcher'}:</span>{' '}
                  {lastTurn.message.length > 220 ? `${lastTurn.message.slice(0, 220)}…` : lastTurn.message}
                </p>
              ) : null}

              {session.outcome ? (
                <div className="mt-3 text-sm">
                  <span className="text-steel">Outcome: </span>
                  {session.outcome_type === 'quote' && quote ? (
                    <>
                      <span className="figure">{eur(quote.total_after_negotiation_cents)}</span>
                      <span className="text-steel"> net · </span>
                      <span className={quote.status === 'confirmed' ? 'text-verified' : 'text-steel'}>
                        {quote.status === 'confirmed' ? 'confirmed by supplier' : quote.status}
                      </span>
                    </>
                  ) : (
                    <span>{session.outcome_type?.replaceAll('_', ' ')}</span>
                  )}
                  <p className="mt-1 max-w-2xl text-steel">{session.outcome.summary}</p>
                </div>
              ) : null}

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-steel hover:text-ink">
                  Full transcript ({session.transcript.length} turns
                  {session.disclosure_event ? ', AI disclosed' : ''})
                </summary>
                <ol className="mt-2 max-h-80 space-y-2 overflow-y-auto border-l-2 border-line pl-4 text-sm">
                  {session.transcript.map((t) => (
                    <li key={t.turn_index}>
                      <span className="figure text-xs text-steel">
                        {String(Math.floor(t.at_ms / 60000)).padStart(2, '0')}:
                        {String(Math.floor((t.at_ms % 60000) / 1000)).padStart(2, '0')}
                      </span>{' '}
                      <span className="text-steel">{t.role === 'buyer' ? 'Agent' : 'Dispatcher'}:</span>{' '}
                      {t.message}
                    </li>
                  ))}
                </ol>
              </details>
            </section>
          );
        })}
      </div>

      {!hasSessions && state ? (
        <p className="mt-8 text-sm text-steel">
          No calls yet. Start the calls to see fees pin to each conversation as they are spoken.
        </p>
      ) : null}
    </div>
  );
}

function StatusBadge({ session }: { session: SessionDto }) {
  if (session.status === 'in_progress') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-hivis" aria-hidden />
        live
      </span>
    );
  }
  if (session.status === 'failed') {
    return <span className="text-xs text-flag">failed{session.failure_state ? ` — ${session.failure_state}` : ''}</span>;
  }
  if (session.status === 'completed') {
    return <span className="text-xs text-steel">completed</span>;
  }
  return <span className="text-xs text-steel">{session.status}</span>;
}
