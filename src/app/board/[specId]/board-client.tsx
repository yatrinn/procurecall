'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { PrimaryButton } from '@/components/form';
import { CallTape, type TapeTurn } from '@/components/call-tape';
import { derivePins, type PinSourceEvent, type PinSourceSession } from '@/components/derive-pins';
import { VoiceCallPanel } from './voice-call-panel';

/**
 * Live negotiation board: one Call Tape per supplier, fees pinning in real
 * time, verified leverage drawn as a link between two tapes. Polls board
 * state every 1.5 s while calls are running.
 */

interface ToolCallRecord {
  turn_index: number;
  tool: string;
  arguments: Record<string, unknown>;
  result: {
    logged?: boolean;
    ok?: boolean;
    line?: {
      label?: string;
      category?: string;
      amount_cents?: number;
      unit?: string;
      is_conditional?: boolean;
    };
    supplier_name?: string;
    verified_total_cents?: number;
  };
  at_ms: number;
}

interface SessionDto {
  id: string;
  supplier_id: string;
  status: string;
  tier: string;
  transport_mode: string;
  outcome_type: string | null;
  outcome: { summary?: string; total_net_cents?: number | null } | null;
  failure_state: string | null;
  transcript: TapeTurn[];
  tool_calls: ToolCallRecord[];
  friction_events: Array<{ turn_index: number; kind: string; note: string }>;
  disclosure_event: { turn_index: number } | null;
  spec_fingerprint: string;
  recording_url: string | null;
  started_at: string | null;
  ended_at: string | null;
}

interface QuoteDto {
  id: string;
  call_id: string;
  supplier_id: string;
  status: string;
  total_before_negotiation_cents: number | null;
  total_after_negotiation_cents: number | null;
  availability_status: string | null;
  is_benchmark_outlier: boolean;
  missing_information: string[];
  price_breakdown: {
    guaranteed_net_cents?: number;
    conditional_cents?: number;
    refundable_deposit_cents?: number;
    tax_cents?: number;
    cash_required_cents?: number;
  } | null;
}

interface EventDto {
  id: string;
  call_id: string;
  event_type: string;
  concession_type: string | null;
  verified_source_quote_id: string | null;
  amount_before_cents: number | null;
  amount_after_cents: number | null;
  transcript_ref: { turn_index?: number } | null;
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
  events: EventDto[];
}

function eur(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `${(cents / 100).toFixed(2)} EUR`;
}

export function BoardClient({
  specId,
  supplierIds,
  voiceOpen = false,
}: {
  specId: string;
  supplierIds: string[];
  voiceOpen?: boolean;
}) {
  const [state, setState] = useState<BoardState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pinElements = useRef(new Map<string, HTMLButtonElement>());
  const [connectors, setConnectors] = useState<
    Array<{ x1: number; y1: number; x2: number; y2: number; label: string }>
  >([]);
  // Evidence anchor: /board/{spec}#call={id}&turn={n} highlights the cited turn.
  const [anchor, setAnchor] = useState<{ callId: string; turn: number } | null>(null);

  useEffect(() => {
    const readHash = () => {
      const m = window.location.hash.match(/call=([0-9a-f-]+)&turn=(\d+)/);
      setAnchor(m ? { callId: m[1], turn: Number(m[2]) } : null);
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  useEffect(() => {
    if (!anchor || !state) return;
    const el = document.getElementById(`tape-${anchor.callId}`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [anchor, state]);

  const anyRunning = (state?.sessions ?? []).some(
    (s) => s.status === 'in_progress' || s.status === 'pending',
  );

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/specs/${specId}/board`, { cache: 'no-store' });
    if (res.ok) setState((await res.json()) as BoardState);
  }, [specId]);

  useEffect(() => {
    const kickoff = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), 1500);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [refresh]);

  const registerPinElement = useCallback((pinId: string, el: HTMLButtonElement | null) => {
    if (el) pinElements.current.set(pinId, el);
    else pinElements.current.delete(pinId);
  }, []);

  // Draw verified-leverage connectors between tapes.
  const recomputeConnectors = useCallback(() => {
    if (!containerRef.current || !state) return;
    const containerBox = containerRef.current.getBoundingClientRect();
    const quoteToCall = new Map(state.quotes.map((q) => [q.id, q.call_id]));
    const next: Array<{ x1: number; y1: number; x2: number; y2: number; label: string }> = [];
    for (const event of state.events) {
      if (event.event_type !== 'leverage_used' || !event.verified_source_quote_id) continue;
      const sourceCallId = quoteToCall.get(event.verified_source_quote_id);
      if (!sourceCallId) continue;
      const from = pinElements.current.get(`outcome-${sourceCallId}`);
      const to = pinElements.current.get(`leverage-${event.id}`);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      next.push({
        x1: a.left + a.width / 2 - containerBox.left,
        y1: a.top + a.height / 2 - containerBox.top,
        x2: b.left + b.width / 2 - containerBox.left,
        y2: b.top + b.height / 2 - containerBox.top,
        label: 'verified leverage',
      });
    }
    setConnectors(next);
  }, [state]);

  useEffect(() => {
    recomputeConnectors();
    window.addEventListener('resize', recomputeConnectors);
    return () => window.removeEventListener('resize', recomputeConnectors);
  }, [recomputeConnectors]);

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
        `${failures.length} of ${supplierIds.length} calls did not complete. Everything captured is on the board; failed calls carry an explicit failure state.`,
      );
    }
    setStarting(false);
    void refresh();
  }, [specId, supplierIds, refresh]);

  const hasSessions = (state?.sessions.length ?? 0) > 0;
  const allDone = hasSessions && !anyRunning;

  const supplierOf = useMemo(() => {
    const map = new Map<string, SupplierDto>();
    for (const s of state?.suppliers ?? []) map.set(s.id, s);
    return (id: string) => map.get(id);
  }, [state?.suppliers]);

  return (
    <div>
      <div className="flex items-center gap-4">
        {!hasSessions ? (
          <>
            <PrimaryButton onClick={startCalls} disabled={starting || !state}>
              {starting ? 'Calling the market…' : `Call ${supplierIds.length} suppliers`}
            </PrimaryButton>
            <span className="text-sm text-steel">
              Text-tier negotiation — the same brain and tools as the voice tier.
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
        {anyRunning ? (
          <span className="flex items-center gap-2 text-sm text-steel">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-hivis" aria-hidden />
            Calls in progress — fees pin to the tapes as they are spoken.
          </span>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-flag">{error}</p> : null}

      <VoiceCallPanel
        specId={specId}
        suppliers={(state?.suppliers ?? [])
          .filter((s) => supplierIds.includes(s.id))
          .map((s) => ({ id: s.id, name: s.name }))}
        onCompleted={refresh}
        defaultOpen={voiceOpen}
      />

      <div ref={containerRef} className="relative mt-6">
        {/* leverage connectors */}
        <svg
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          aria-hidden
        >
          {connectors.map((c, i) => {
            const midY = (c.y1 + c.y2) / 2;
            return (
              <g key={i} stroke="var(--verified)" fill="none">
                <path
                  d={`M ${c.x1} ${c.y1} C ${c.x1} ${midY}, ${c.x2} ${midY}, ${c.x2} ${c.y2}`}
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                />
                <circle cx={c.x1} cy={c.y1} r="3" fill="var(--verified)" stroke="none" />
                <circle cx={c.x2} cy={c.y2} r="3" fill="var(--verified)" stroke="none" />
              </g>
            );
          })}
        </svg>

        <div className="space-y-12">
          {(state?.sessions ?? []).map((session) => (
            <TapeSection
              key={session.id}
              session={session}
              supplier={supplierOf(session.supplier_id)}
              quote={state?.quotes.find((q) => q.call_id === session.id)}
              events={(state?.events ?? []).filter((e) => e.call_id === session.id)}
              registerPinElement={registerPinElement}
              onLayout={recomputeConnectors}
              highlightTurn={anchor?.callId === session.id ? anchor.turn : null}
            />
          ))}
        </div>
      </div>

      {!hasSessions && state ? (
        <p className="mt-8 text-sm text-steel">
          No calls yet. Start the calls to watch three negotiations run on one identical brief.
        </p>
      ) : null}
    </div>
  );
}

function TapeSection({
  session,
  supplier,
  quote,
  events,
  registerPinElement,
  onLayout,
  highlightTurn,
}: {
  session: SessionDto;
  supplier: SupplierDto | undefined;
  quote: QuoteDto | undefined;
  events: EventDto[];
  registerPinElement: (pinId: string, el: HTMLButtonElement | null) => void;
  onLayout: () => void;
  highlightTurn?: number | null;
}) {
  useEffect(() => {
    onLayout();
  }, [session.status, session.transcript.length, onLayout]);

  const pins = useMemo(
    () => derivePins(session as unknown as PinSourceSession, events as PinSourceEvent[]),
    [session, events],
  );

  const durationMs = useMemo(() => {
    const lastTurn = session.transcript[session.transcript.length - 1];
    return Math.max(lastTurn?.at_ms ?? 0, 1) + 8000;
  }, [session.transcript]);

  return (
    <section className="border-t border-line pt-4" id={`tape-${session.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="font-medium">{supplier?.name ?? 'Supplier'}</h2>
        <span className="text-xs text-steel">
          {supplier?.is_simulated ? 'simulated supplier' : 'live'} · {supplier?.location ?? ''} ·{' '}
          {session.tier} tier
        </span>
        <span className="figure ml-auto text-xs text-steel">
          {session.spec_fingerprint.slice(0, 12)}
        </span>
        <StatusBadge session={session} />
      </div>

      <CallTape
        callId={session.id}
        turns={session.transcript}
        pins={pins}
        durationMs={durationMs}
        audioUrl={session.recording_url}
        registerPinElement={registerPinElement}
        highlightTurn={highlightTurn}
      />

      {quote ? (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-steel">Guaranteed net </span>
            <span className="figure">{eur(quote.total_after_negotiation_cents)}</span>
            {quote.total_before_negotiation_cents !== null &&
            quote.total_after_negotiation_cents !== null &&
            quote.total_before_negotiation_cents !== quote.total_after_negotiation_cents ? (
              <span className="figure text-verified">
                {' '}
                (was {eur(quote.total_before_negotiation_cents)})
              </span>
            ) : null}
          </span>
          {quote.price_breakdown?.conditional_cents ? (
            <span>
              <span className="text-steel">Conditional up to </span>
              <span className="figure">{eur(quote.price_breakdown.conditional_cents)}</span>
            </span>
          ) : null}
          {quote.price_breakdown?.refundable_deposit_cents ? (
            <span>
              <span className="text-steel">Deposit (refundable) </span>
              <span className="figure">{eur(quote.price_breakdown.refundable_deposit_cents)}</span>
            </span>
          ) : null}
          <span className={quote.status === 'confirmed' ? 'text-verified' : 'text-steel'}>
            {quote.status === 'confirmed' ? 'confirmed by supplier' : quote.status}
          </span>
          {quote.is_benchmark_outlier ? (
            <span className="text-flag">far below market benchmark — flagged for review</span>
          ) : null}
          {quote.missing_information.length > 0 ? (
            <span className="text-flag">
              unpriced: {quote.missing_information.join(', ')} — an incomplete quote is not a
              cheap quote
            </span>
          ) : null}
        </div>
      ) : null}

      {session.outcome && session.outcome_type !== 'quote' ? (
        <p className="mt-3 max-w-2xl text-sm text-steel">
          <span className="text-ink">{session.outcome_type?.replaceAll('_', ' ')}: </span>
          {session.outcome.summary}
        </p>
      ) : null}
    </section>
  );
}

function StatusBadge({ session }: { session: SessionDto }) {
  if (session.status === 'in_progress' || session.status === 'pending') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-hivis" aria-hidden />
        live
      </span>
    );
  }
  if (session.status === 'failed') {
    return (
      <span className="text-xs text-flag">
        failed{session.failure_state ? ` — ${session.failure_state}` : ''}
      </span>
    );
  }
  return <span className="text-xs text-steel">{session.status}</span>;
}
