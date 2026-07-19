'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CallTape, formatMs, type TapePin, type TapeTurn } from '@/components/call-tape';
import { PrimaryButton, QuietButton } from '@/components/form';

/**
 * Verified replay: a faithful, time-true re-render of a genuinely dynamic
 * recorded run. Nothing is synthesized at view time; the tapes reveal exactly
 * what happened, when it happened. Always labeled as a replay.
 */

export interface ReplaySession {
  id: string;
  supplier_name: string;
  supplier_location: string | null;
  behavior_label: string;
  turns: TapeTurn[];
  pins: TapePin[];
  duration_ms: number;
  outcome_line: string;
  quote_before_cents: number | null;
  quote_after_cents: number | null;
  /** Signed URL of the call recording (voice runs). */
  audio_url: string | null;
  currency: string;
}

const SPEED = 14; // replay time compression

export function ReplayClient({ sessions }: { sessions: ReplaySession[] }) {
  const maxMs = useMemo(
    () => Math.max(...sessions.map((s) => s.duration_ms), 1),
    [sessions],
  );
  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    // Interval instead of requestAnimationFrame: keeps advancing in
    // background tabs and under prefers-reduced-motion the reveal is discrete
    // anyway (pins appear, nothing glides).
    let last = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setClock((c) => {
        const next = c + dt * SPEED;
        if (next >= maxMs) {
          setPlaying(false);
          return maxMs;
        }
        return next;
      });
    }, 120);
    return () => clearInterval(interval);
  }, [playing, maxMs]);

  const done = clock >= maxMs;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {!playing && !done ? (
          <PrimaryButton onClick={() => setPlaying(true)}>
            {clock === 0 ? 'Play the recorded run' : 'Resume'}
          </PrimaryButton>
        ) : null}
        {playing ? <QuietButton onClick={() => setPlaying(false)}>Pause</QuietButton> : null}
        {clock > 0 ? (
          <QuietButton
            onClick={() => {
              setPlaying(false);
              setClock(0);
            }}
          >
            Restart
          </QuietButton>
        ) : null}
        <span className="figure text-sm text-steel">
          {formatMs(Math.min(clock, maxMs))} / {formatMs(maxMs)} · {SPEED}× speed
        </span>
        <span className="rounded-sm border border-line bg-paper px-2 py-0.5 text-xs text-steel">
          Verified replay — recorded live run, nothing synthesized
        </span>
      </div>

      <div className="mt-6 space-y-10">
        {sessions.map((s) => (
          <section key={s.id} className="border-t border-line pt-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h3 className="font-medium">{s.supplier_name}</h3>
              <span className="text-xs text-steel">
                {s.behavior_label} · simulated supplier · {s.supplier_location ?? ''}
              </span>
              {clock >= s.duration_ms ? (
                <span className="ml-auto text-xs">
                  {s.quote_before_cents !== null &&
                  s.quote_after_cents !== null &&
                  s.quote_before_cents !== s.quote_after_cents ? (
                    <span className="figure text-verified">
                      {(s.quote_before_cents / 100).toFixed(2)} → {(s.quote_after_cents / 100).toFixed(2)}{' '}
                      {s.currency} net
                    </span>
                  ) : s.quote_after_cents !== null ? (
                    <span className="figure">
                      {(s.quote_after_cents / 100).toFixed(2)} {s.currency} net
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            <CallTape
              callId={s.id}
              turns={s.turns}
              pins={s.pins}
              durationMs={maxMs}
              audioUrl={s.audio_url}
              revealUntilMs={clock}
            />
            {clock >= s.duration_ms ? (
              <p className="mt-2 max-w-2xl text-sm text-steel">{s.outcome_line}</p>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}

export function RunLive() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetNote, setResetNote] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/demo/run', { method: 'POST' });
    const body = (await res.json()) as { spec_id?: string; error?: string };
    if (!res.ok || !body.spec_id) {
      setError(body.error ?? 'The live run could not be started.');
      setBusy(false);
      return;
    }
    router.push(`/board/${body.spec_id}`);
  }, [router]);

  const voiceRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/golden/voice-spec', { method: 'POST' });
    const body = (await res.json()) as { spec_id?: string; error?: string };
    if (!res.ok || !body.spec_id) {
      setError(body.error ?? 'The voice run could not be prepared.');
      setBusy(false);
      return;
    }
    router.push(`/board/${body.spec_id}?voice=1`);
  }, [router]);

  const reset = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResetNote(null);
    const res = await fetch('/api/demo/reset', { method: 'POST' });
    const body = (await res.json()) as { ok?: boolean; removed_specs?: number; error?: string };
    if (!res.ok) {
      setError(body.error ?? 'Reset failed.');
    } else {
      setResetNote(
        body.removed_specs === 0
          ? 'Nothing to remove — the demo is clean.'
          : `Removed ${body.removed_specs} visitor run(s). The recorded replay is untouched.`,
      );
    }
    setBusy(false);
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton onClick={run} disabled={busy}>
          {busy ? 'Preparing…' : 'Run it live now'}
        </PrimaryButton>
        <QuietButton onClick={voiceRun} disabled={busy}>
          Voice call — you play the dispatcher
        </QuietButton>
        <QuietButton onClick={reset} disabled={busy}>
          Reset demo data
        </QuietButton>
      </div>
      <p className="mt-2 max-w-xl text-xs text-steel">
        Live run: same brief, new calls — wording and outcomes can differ from the recording.
        Voice option: the buyer agent talks; you answer as the dispatcher. Sessions cap at
        4 minutes.
      </p>
      {error ? <p className="mt-3 text-sm text-flag">{error}</p> : null}
      {resetNote ? <p className="mt-3 text-sm text-steel">{resetNote}</p> : null}
    </div>
  );
}
