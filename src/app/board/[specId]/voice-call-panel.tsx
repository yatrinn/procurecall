'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { QuietButton } from '@/components/form';

/**
 * Voice negotiation: you speak as the dispatcher.
 *
 * iOS Safari quirks this panel works around:
 * 1) Prefetch the signed session so Start can call ElevenLabs immediately
 *    inside the tap (no await-fetch before getUserMedia).
 * 2) Start on pointerdown — more reliable user-activation than click alone.
 * 3) If the site was previously set to Don't Allow, Safari will NEVER show
 *    the Allow sheet again until Website Settings are changed — we surface
 *    that path explicitly (no typing fallback).
 */

export function VoiceCallPanel({
  specId,
  suppliers,
  onCompleted,
  defaultOpen = false,
}: {
  specId: string;
  suppliers: Array<{ id: string; name: string }>;
  onCompleted: () => void;
  defaultOpen?: boolean;
}) {
  return (
    <ConversationProvider>
      <VoiceCallInner
        specId={specId}
        suppliers={suppliers}
        onCompleted={onCompleted}
        defaultOpen={defaultOpen}
      />
    </ConversationProvider>
  );
}

const VOICE_CAP_SECONDS = 480;

type PrefetchedSession = {
  supplierId: string;
  call_id: string;
  signed_url: string;
  dynamic_variables: Record<string, string>;
};

function unlockAudio() {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    void ctx.resume();
    // Brief beep-free unlock: close after resume settles.
    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 500);
  } catch {
    /* ignore */
  }
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function VoiceCallInner({
  specId,
  suppliers,
  onCompleted,
  defaultOpen,
}: {
  specId: string;
  suppliers: Array<{ id: string; name: string }>;
  onCompleted: () => void;
  defaultOpen?: boolean;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [micBlocked, setMicBlocked] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'live' | 'finishing'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);
  const callIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const agentByeRef = useRef(false);
  const hangupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endSessionRef = useRef<() => Promise<void>>(async () => {});
  const selectedSupplierIdRef = useRef('');
  const prefetchRef = useRef<PrefetchedSession | null>(null);
  const prefetchingRef = useRef<string | null>(null);
  const startingRef = useRef(false);

  const selectedSupplierId =
    supplierId && suppliers.some((s) => s.id === supplierId)
      ? supplierId
      : (suppliers[0]?.id ?? '');

  useEffect(() => {
    selectedSupplierIdRef.current = selectedSupplierId;
  }, [selectedSupplierId]);

  const prefetchSession = useCallback(
    async (forSupplierId: string) => {
      if (!forSupplierId) return;
      if (
        prefetchRef.current?.supplierId === forSupplierId &&
        prefetchRef.current.signed_url
      ) {
        setReady(true);
        return;
      }
      if (prefetchingRef.current === forSupplierId) return;
      prefetchingRef.current = forSupplierId;
      try {
        const res = await fetch('/api/calls/voice-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spec_id: specId, supplier_id: forSupplierId }),
        });
        const body = (await res.json()) as {
          call_id?: string;
          signed_url?: string;
          dynamic_variables?: Record<string, string>;
          error?: string;
        };
        if (!res.ok || !body.signed_url || !body.call_id) {
          setError(body.error ?? 'Voice session could not be prepared.');
          setReady(false);
          return;
        }
        prefetchRef.current = {
          supplierId: forSupplierId,
          call_id: body.call_id,
          signed_url: body.signed_url,
          dynamic_variables: body.dynamic_variables ?? { call_id: body.call_id },
        };
        setReady(true);
        setError(null);
      } catch {
        setError('Voice session could not be prepared. Check your connection.');
        setReady(false);
      } finally {
        if (prefetchingRef.current === forSupplierId) prefetchingRef.current = null;
      }
    },
    [specId],
  );

  // Warm session after paint — deferred so we don't setState sync in the effect.
  useEffect(() => {
    if (!selectedSupplierId) return;
    const id = selectedSupplierId;
    const t = window.setTimeout(() => {
      void prefetchSession(id);
    }, 0);
    return () => window.clearTimeout(t);
  }, [selectedSupplierId, prefetchSession]);

  useEffect(() => {
    if (phase !== 'live') return;
    const startedAt = Date.now();
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [phase]);

  const conversation = useConversation({
    onConnect: ({ conversationId }: { conversationId: string }) => {
      conversationIdRef.current = conversationId;
      setPhase('live');
      startingRef.current = false;
    },
    onDisconnect: () => {
      void finish();
    },
    onError: (message: string) => {
      startingRef.current = false;
      const lower = (message || '').toLowerCase();
      if (lower.includes('mic') || lower.includes('permission') || lower.includes('notallowed')) {
        setMicBlocked(true);
        setError(null);
      } else {
        setError(message || 'Voice session error');
      }
      setPhase('idle');
      // Session token may be spent — refresh for next attempt.
      prefetchRef.current = null;
      void prefetchSession(selectedSupplierIdRef.current);
    },
    onMessage: ({ message, source }: { message: string; source: string }) => {
      if (source === 'ai' && /\b(bye|goodbye|talk soon)\b/i.test(message)) {
        agentByeRef.current = true;
        if (hangupTimerRef.current) clearTimeout(hangupTimerRef.current);
        hangupTimerRef.current = setTimeout(() => {
          void endSessionRef.current();
        }, 2200);
      }
      if (
        source === 'user' &&
        agentByeRef.current &&
        /\b(bye|goodbye|talk soon|thanks)\b/i.test(message)
      ) {
        if (hangupTimerRef.current) clearTimeout(hangupTimerRef.current);
        void endSessionRef.current();
      }
    },
  });

  useEffect(() => {
    endSessionRef.current = async () => {
      await conversation.endSession();
    };
  }, [conversation]);

  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    startingRef.current = false;
    if (hangupTimerRef.current) clearTimeout(hangupTimerRef.current);
    setPhase('finishing');
    const callId = callIdRef.current;
    const conversationId = conversationIdRef.current;
    if (callId && conversationId) {
      await fetch(`/api/calls/${callId}/voice-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).catch(() => undefined);
    }
    setPhase('idle');
    prefetchRef.current = null;
    void prefetchSession(selectedSupplierIdRef.current);
    onCompleted();
  }, [onCompleted, prefetchSession]);

  /**
   * Fired from pointerdown so iOS still has a user gesture when ElevenLabs
   * requests the microphone. Prefetch means we do not await network first.
   */
  const beginCall = useCallback(() => {
    if (startingRef.current || phase !== 'idle') return;
    if (!selectedSupplierIdRef.current) return;

    const session = prefetchRef.current;
    if (!session || session.supplierId !== selectedSupplierIdRef.current) {
      setError('Preparing the call… tap Start voice call again in a moment.');
      void prefetchSession(selectedSupplierIdRef.current);
      return;
    }

    startingRef.current = true;
    setError(null);
    setMicBlocked(false);
    finishedRef.current = false;
    agentByeRef.current = false;
    setElapsed(0);
    setPhase('starting');
    callIdRef.current = session.call_id;

    unlockAudio();

    // Hand the mic request to ElevenLabs immediately — still in the gesture.
    conversation.startSession({
      signedUrl: session.signed_url,
      dynamicVariables: session.dynamic_variables,
    });

    // Consume this prefetched session so a retry gets a fresh one.
    prefetchRef.current = null;
    setReady(false);
  }, [phase, conversation, prefetchSession]);

  const stop = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  return (
    <details className="mt-4" open={defaultOpen}>
      <summary className="cursor-pointer text-xs text-steel hover:text-ink">
        Voice call (you play the dispatcher, budget-capped)
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          value={selectedSupplierId}
          onChange={(e) => {
            setSupplierId(e.target.value);
            prefetchRef.current = null;
            setReady(false);
          }}
          disabled={phase !== 'idle'}
          className="rounded-sm border border-line bg-paper px-2 py-1.5 text-sm"
          aria-label="Supplier to call"
        >
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {phase === 'live' ? (
          <>
            <QuietButton onClick={stop}>End call</QuietButton>
            <span className="flex items-center gap-1.5 text-sm text-ink">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-hivis" aria-hidden />
              live · speak as the dispatcher
            </span>
            <span
              className={`figure text-sm ${VOICE_CAP_SECONDS - elapsed <= 60 ? 'text-flag' : 'text-steel'}`}
              aria-live="polite"
            >
              {Math.floor((VOICE_CAP_SECONDS - elapsed) / 60)}:
              {String((VOICE_CAP_SECONDS - elapsed) % 60).padStart(2, '0')} left
            </span>
          </>
        ) : (
          <button
            type="button"
            disabled={phase !== 'idle' || !selectedSupplierId || !ready}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              beginCall();
            }}
            onClick={() => {
              if (startingRef.current || phase !== 'idle') return;
              beginCall();
            }}
            className="rounded-sm border border-line bg-paper px-4 py-2 text-sm text-ink hover:border-steel disabled:cursor-not-allowed disabled:opacity-40"
          >
            {phase === 'starting'
              ? 'Connecting…'
              : phase === 'finishing'
                ? 'Saving…'
                : ready
                  ? 'Start voice call'
                  : 'Preparing…'}
          </button>
        )}
        <span className="text-xs text-steel">
          Caps at 8 minutes. Hang up after ~25 s of silence. Safari will ask to use the
          microphone — choose Allow.
        </span>
      </div>

      {micBlocked ? (
        <div className="mt-3 max-w-xl border border-flag/40 bg-paper p-3 text-sm">
          <p className="font-medium text-flag">
            Safari blocked the microphone for this site — so the Allow popup will not appear.
          </p>
          {isIos() ? (
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink">
              <li>Tap the aA icon on the left of the Safari address bar.</li>
              <li>Tap Website Settings.</li>
              <li>Set Microphone to Allow.</li>
              <li>Come back and tap Start voice call.</li>
            </ol>
          ) : (
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink">
              <li>Open Safari Settings → Websites → Microphone.</li>
              <li>Set procurecall.vercel.app to Allow.</li>
              <li>Reload this page and tap Start voice call.</li>
            </ol>
          )}
          <div className="mt-3">
            <QuietButton
              type="button"
              onClick={() => {
                setMicBlocked(false);
                void prefetchSession(selectedSupplierIdRef.current);
              }}
            >
              I set it to Allow — try again
            </QuietButton>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-flag">{error}</p> : null}
    </details>
  );
}
