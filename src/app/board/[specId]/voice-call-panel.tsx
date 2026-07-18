'use client';

import { useCallback, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { QuietButton } from '@/components/form';

/**
 * Voice negotiation (human_roleplay transport): the buyer is the live
 * ElevenLabs voice agent running our custom-LLM brain — identical tools and
 * truth-layer gating as the text tier. The person on this microphone plays
 * the supplier's dispatcher. Budget-gated server-side; sessions are capped at
 * 240 s with auto-hangup on silence.
 */

export function VoiceCallPanel({
  specId,
  suppliers,
  onCompleted,
}: {
  specId: string;
  suppliers: Array<{ id: string; name: string }>;
  onCompleted: () => void;
}) {
  return (
    <ConversationProvider>
      <VoiceCallInner specId={specId} suppliers={suppliers} onCompleted={onCompleted} />
    </ConversationProvider>
  );
}

function VoiceCallInner({
  specId,
  suppliers,
  onCompleted,
}: {
  specId: string;
  suppliers: Array<{ id: string; name: string }>;
  onCompleted: () => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'live' | 'finishing'>('idle');
  const callIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const finishedRef = useRef(false);

  const conversation = useConversation({
    onConnect: ({ conversationId }: { conversationId: string }) => {
      conversationIdRef.current = conversationId;
      setPhase('live');
    },
    onDisconnect: () => {
      void finish();
    },
    onError: (message: string) => setError(message || 'Voice session error'),
  });

  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
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
    setPhase('starting');
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access is required — you play the dispatcher on this call.');
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
    <details className="mt-4">
      <summary className="cursor-pointer text-xs text-steel hover:text-ink">
        Voice call — you play the dispatcher (budget-capped)
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
              live — the agent speaks for the buyer; answer as the dispatcher
            </span>
          </>
        ) : (
          <QuietButton onClick={start} disabled={phase !== 'idle' || !supplierId}>
            {phase === 'starting' ? 'Connecting…' : phase === 'finishing' ? 'Saving call…' : 'Start voice call'}
          </QuietButton>
        )}
        <span className="text-xs text-steel">
          Voice sessions cap at 4 minutes and hang up after 20 s of silence.
        </span>
      </div>
      {error ? <p className="mt-2 text-sm text-flag">{error}</p> : null}
    </details>
  );
}
