'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The Call Tape. the product's signature element (DESIGN_SYSTEM.md).
 *
 * A horizontal tape is the literal spine of a call: turn blocks laid out on a
 * time axis, and every extracted fee, disclosure, friction event, verified
 * leverage use, and outcome pinned at the moment it happened. Clicking a pin
 * highlights the transcript turn; when a recording exists, it also seeks the
 * audio to that second. Verified leverage pins are drawn in --verified. the
 * only decorative-free use of that color in the app.
 */

export interface TapeTurn {
  turn_index: number;
  role: 'buyer' | 'supplier';
  message: string;
  at_ms: number;
  audio_start_s?: number | null;
}

export interface TapePin {
  id: string;
  at_ms: number;
  turn_index: number;
  kind: 'fee' | 'conditional_fee' | 'disclosure' | 'friction' | 'leverage' | 'concession' | 'outcome' | 'flag';
  label: string;
  amount_label?: string;
  audio_start_s?: number | null;
}

export function CallTape({
  callId,
  turns: allTurns,
  pins: allPins,
  durationMs,
  audioUrl,
  registerPinElement,
  highlightTurn,
  onSelectTurn,
  revealUntilMs,
}: {
  callId: string;
  turns: TapeTurn[];
  pins: TapePin[];
  durationMs: number;
  audioUrl?: string | null;
  /** Lets a parent overlay draw connectors between pins across tapes. */
  registerPinElement?: (pinId: string, el: HTMLButtonElement | null) => void;
  highlightTurn?: number | null;
  onSelectTurn?: (turnIndex: number) => void;
  /** Verified replay: only render content up to this moment. */
  revealUntilMs?: number | null;
}) {
  const [openTurn, setOpenTurn] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  const turns = useMemo(
    () =>
      revealUntilMs === null || revealUntilMs === undefined
        ? allTurns
        : allTurns.filter((t) => t.at_ms <= revealUntilMs),
    [allTurns, revealUntilMs],
  );
  const pins = useMemo(
    () =>
      revealUntilMs === null || revealUntilMs === undefined
        ? allPins
        : allPins.filter((p) => p.at_ms <= revealUntilMs),
    [allPins, revealUntilMs],
  );

  const total = Math.max(durationMs, 1);
  const pos = (ms: number) => `${Math.min(97, Math.max(1, (ms / total) * 96 + 2))}%`;

  const activeTurn = highlightTurn ?? openTurn;

  const focusTurn = useCallback((turnIndex: number, audioStartS?: number | null) => {
    if (audioRef.current && audioStartS !== null && audioStartS !== undefined) {
      audioRef.current.currentTime = Math.max(0, audioStartS);
      void audioRef.current.play().catch(() => undefined);
    }
    const el = listRef.current?.querySelector(`[data-turn="${turnIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const selectTurn = useCallback(
    (turnIndex: number, audioStartS?: number | null) => {
      setOpenTurn(turnIndex);
      onSelectTurn?.(turnIndex);
      focusTurn(turnIndex, audioStartS);
    },
    [onSelectTurn, focusTurn],
  );

  useEffect(() => {
    if (highlightTurn !== null && highlightTurn !== undefined) {
      // Evidence anchors must also SEEK the audio, not just highlight text.
      const turn = turns.find((t) => t.turn_index === highlightTurn);
      focusTurn(highlightTurn, turn?.audio_start_s);
    }
  }, [highlightTurn, focusTurn, turns]);

  const lanes = useMemo(() => assignLanes(pins, total), [pins, total]);

  // Lane geometry: spine at 44px; two label lanes above, two below.
  const LANE_TOP: Record<number, string> = { 0: '0px', 1: '16px', 2: '58px', 3: '74px' };

  return (
    <div className="min-w-0">
      {/* The tape itself. scroll horizontally on narrow screens instead of blowing the page width */}
      <div
        className="relative mt-6 h-[92px] min-w-[280px] overflow-x-auto sm:overflow-visible"
        role="group"
        aria-label={`Call tape ${callId}`}
      >
        {/* spine */}
        <div className="absolute left-0 right-0 top-[44px] h-px bg-line" aria-hidden />
        {/* replay playhead */}
        {revealUntilMs !== null && revealUntilMs !== undefined && revealUntilMs < total ? (
          <div
            className="absolute top-[20px] h-[48px] w-px bg-ink/60"
            style={{ left: pos(revealUntilMs) }}
            aria-hidden
          />
        ) : null}
        {/* turn blocks */}
        {turns.map((t) => {
          const next = turns.find((x) => x.turn_index > t.turn_index);
          const width = Math.max(
            0.5,
            (((next?.at_ms ?? total) - t.at_ms) / total) * 96,
          );
          return (
            <button
              key={t.turn_index}
              data-tape-turn={t.turn_index}
              onClick={() => selectTurn(t.turn_index, t.audio_start_s)}
              className={`absolute top-[42px] h-[5px] rounded-sm transition-colors ${
                t.role === 'buyer' ? 'bg-ink/70 hover:bg-ink' : 'bg-steel/40 hover:bg-steel'
              } ${activeTurn === t.turn_index ? '!bg-hivis' : ''}`}
              style={{ left: pos(t.at_ms), width: `${width}%` }}
              aria-label={`${t.role} turn at ${formatMs(t.at_ms)}`}
              title={`${t.role} · ${formatMs(t.at_ms)}`}
            />
          );
        })}
        {/* pins */}
        {pins.map((pin) => {
          const style = pinStyle(pin.kind);
          const lane = lanes.get(pin.id) ?? 0;
          const above = lane <= 1;
          return (
            <button
              key={pin.id}
              ref={(el) => registerPinElement?.(pin.id, el)}
              onClick={() => selectTurn(pin.turn_index, pin.audio_start_s)}
              className="group absolute z-[1] -translate-x-1/2"
              style={{ left: pos(pin.at_ms), top: LANE_TOP[lane] }}
              aria-label={`${pin.label}${pin.amount_label ? ` ${pin.amount_label}` : ''} at ${formatMs(pin.at_ms)}`}
              title={`${pin.label}${pin.amount_label ? `. ${pin.amount_label}` : ''} · ${formatMs(pin.at_ms)}`}
            >
              <span className="flex items-center gap-1 rounded-sm bg-ground/80 px-0.5">
                <span
                  className={`inline-block h-2 w-2 flex-none rounded-sm border ${style.dot}`}
                  aria-hidden
                />
                <span
                  className={`whitespace-nowrap text-[10px] leading-none ${style.text} opacity-85 group-hover:opacity-100`}
                >
                  {pin.amount_label ? (
                    <span className="figure">{pin.amount_label}</span>
                  ) : (
                    pin.label
                  )}
                </span>
              </span>
              {/* connector to spine */}
              <span
                className={`absolute left-[3px] w-px ${
                  above
                    ? lane === 0
                      ? 'top-[10px] h-[34px]'
                      : 'top-[10px] h-[18px]'
                    : lane === 2
                      ? '-top-[14px] h-[14px]'
                      : '-top-[30px] h-[30px]'
                } ${style.line} opacity-60`}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      {audioUrl ? (
        <div className="mt-3">
          <p className="mb-1 text-xs text-steel">
            Call recording. Press play to listen; clicking a pin seeks to that second.
          </p>
          <audio ref={audioRef} controls preload="none" src={audioUrl} className="h-8 w-full">
            Your browser does not support audio playback.
          </audio>
        </div>
      ) : null}

      {/* transcript: always the full conversation, even while the tape is
          still revealing. Reading along must not depend on the replay clock. */}
      <details className="mt-3" open={activeTurn !== null}>
        <summary className="cursor-pointer text-xs text-steel hover:text-ink">
          Transcript ({allTurns.length} turns)
        </summary>
        <ol
          ref={listRef}
          className="mt-2 max-h-72 space-y-2 overflow-y-auto border-l-2 border-line pl-4 text-sm"
        >
          {allTurns.map((t) => (
            <li
              key={t.turn_index}
              data-turn={t.turn_index}
              className={`rounded-sm px-2 py-1 ${
                activeTurn === t.turn_index ? 'bg-hivis/20' : ''
              }`}
            >
              <span className="figure text-xs text-steel">{formatMs(t.at_ms)}</span>{' '}
              <span className="text-steel">{t.role === 'buyer' ? 'Agent' : 'Dispatcher'}:</span>{' '}
              {t.message}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function pinStyle(kind: TapePin['kind']): { dot: string; text: string; line: string } {
  switch (kind) {
    case 'fee':
      return { dot: 'border-ink bg-paper', text: 'text-ink', line: 'bg-line' };
    case 'conditional_fee':
      return { dot: 'border-steel bg-paper', text: 'text-steel', line: 'bg-line' };
    case 'leverage':
      return { dot: 'border-verified bg-verified', text: 'text-verified', line: 'bg-verified' };
    case 'concession':
      return { dot: 'border-verified bg-paper', text: 'text-verified', line: 'bg-verified' };
    case 'outcome':
      return { dot: 'border-ink bg-ink', text: 'text-ink', line: 'bg-line' };
    case 'disclosure':
      return { dot: 'border-steel bg-steel', text: 'text-steel', line: 'bg-line' };
    case 'friction':
    case 'flag':
      return { dot: 'border-flag bg-paper', text: 'text-flag', line: 'bg-flag' };
  }
}

/**
 * Four label lanes (two above, two below the spine). Greedy assignment: each
 * pin takes the first lane whose previous label is far enough away, measured
 * against the tape's actual time scale so labels do not overlap visually.
 */
function assignLanes(pins: TapePin[], totalMs: number): Map<string, number> {
  const sorted = [...pins].sort((a, b) => a.at_ms - b.at_ms);
  const lanes = new Map<string, number>();
  // Minimum separation: ~9% of tape width worth of milliseconds.
  const minGap = Math.max(1, totalMs * 0.09);
  const lastAt: number[] = [-Infinity, -Infinity, -Infinity, -Infinity];
  // Leverage and concession pins prefer the lower lanes (near the connector overlay).
  const preference = (pin: TapePin) =>
    pin.kind === 'leverage' || pin.kind === 'concession' ? [2, 3, 0, 1] : [0, 2, 1, 3];
  for (const pin of sorted) {
    let assigned = false;
    for (const lane of preference(pin)) {
      if (pin.at_ms - lastAt[lane] >= minGap) {
        lanes.set(pin.id, lane);
        lastAt[lane] = pin.at_ms;
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      // Take the least-recently-used lane; slight overlap beats disappearing.
      const lane = lastAt.indexOf(Math.min(...lastAt));
      lanes.set(pin.id, lane);
      lastAt[lane] = pin.at_ms;
    }
  }
  return lanes;
}

export function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
