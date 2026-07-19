'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { QuietButton } from '@/components/form';

/**
 * Voice negotiation (human_roleplay transport): the buyer is the live
 * ElevenLabs voice agent running our custom-LLM brain. identical tools and
 * truth-layer gating as the text tier. The person on this microphone plays
 * the supplier's dispatcher. Budget-gated server-side; sessions are capped at
 * 240 s with auto-hangup on silence.
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
  const [phase, setPhase] = useState<'idle' | 'starting' | 'live' | 'finishing'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const callIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const agentByeRef = useRef(false);
  const hangupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endSessionRef = useRef<() => Promise<void>>(async () => {});

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
    },
    onDisconnect: () => {
      void finish();
    },
    onError: (message: string) => setError(message || 'Voice session error'),
    onMessage: ({ message, source }: { message: string; source: string }) => {
      // Backup hangup: once goodbye has been said, end the session so we
      // never loop five farewells if end_call did not fire.
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
    onCompleted();
  }, [onCompleted]);

  const start = useCallback(async () => {
    setError(null);
    finishedRef.current = false;
    agentByeRef.current = false;
    setElapsed(0);
    setPhase('starting');
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access is required. You play the dispatcher on this call.');
      setPhase('idle');
      return;
    }
    const res = await fetch('/api/calls/voice-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec_id: specId, supplier_id: supplierId }),
    });
    const body = (await res.json()) as {
      call_id?: string;
      signed_url?: string;
      dynamic_variables?: Record<string, string>;
      error?: string;
    };
    if (!res.ok || !body.signed_url || !body.call_id) {
      setError(body.error ?? 'Voice session could not be started.');
      setPhase('idle');
      return;
    }
    callIdRef.current = body.call_id;
    await conversation.startSession({
      signedUrl: body.signed_url,
      dynamicVariables: body.dynamic_variables,
    });
  }, [conversation, specId, supplierId]);

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
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
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
              live. The agent speaks for the buyer; answer as the dispatcher
            </span>
            <span
              className={`figure text-sm ${VOICE_CAP_SECONDS - elapsed <= 60 ? 'text-flag' : 'text-steel'}`}
              aria-live="polite"
              title="Time remaining before the hard cap"
            >
              {Math.floor((VOICE_CAP_SECONDS - elapsed) / 60)}:
              {String((VOICE_CAP_SECONDS - elapsed) % 60).padStart(2, '0')} left
            </span>
          </>
        ) : (
          <QuietButton onClick={start} disabled={phase !== 'idle' || !supplierId}>
            {phase === 'starting' ? 'Connecting…' : phase === 'finishing' ? 'Saving call…' : 'Start voice call'}
          </QuietButton>
        )}
        <span className="text-xs text-steel">
          Voice sessions cap at 8 minutes and hang up after 45 s of silence. Every turn is saved
          as it happens. An interrupted call keeps everything spoken and becomes a partial
          quote, not a decline.
        </span>
      </div>
      {error ? <p className="mt-2 text-sm text-flag">{error}</p> : null}
    </details>
  );
}
