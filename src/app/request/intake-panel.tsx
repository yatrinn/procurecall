'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { PrimaryButton, QuietButton } from '@/components/form';

type Path = 'voice' | 'document' | 'text';

interface TranscriptTurn {
  role: 'user' | 'agent';
  message: string;
}

export function IntakePanel({
  vertical,
  placeholder,
}: {
  vertical: string;
  placeholder?: string;
}) {
  const router = useRouter();
  const [path, setPath] = useState<Path>('voice');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitTranscript = useCallback(
    async (turns: TranscriptTurn[]) => {
      setBusy(true);
      setError(null);
      const text = turns
        .map((t) => `${t.role === 'agent' ? 'Interviewer' : 'Requester'}: ${t.message}`)
        .join('\n');
      const res = await fetch('/api/intake/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source: 'voice', vertical }),
      });
      const body = (await res.json()) as { spec_id?: string; error?: string };
      if (!res.ok || !body.spec_id) {
        setError(body.error ?? 'The interview could not be processed.');
        setBusy(false);
        return;
      }
      router.push(`/request/${body.spec_id}`);
    },
    [router, vertical],
  );

  return (
    <div>
      <div className="flex gap-2" role="tablist" aria-label="Intake method">
        {(
          [
            ['voice', 'Voice interview'],
            ['document', 'Upload a document'],
            ['text', 'Type it'],
          ] as Array<[Path, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={path === value}
            onClick={() => setPath(value)}
            className={`rounded-sm border px-3 py-1.5 text-sm ${
              path === value
                ? 'border-ink bg-ink text-paper'
                : 'border-line bg-paper text-steel hover:border-steel'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 max-w-xl">
        {path === 'voice' ? (
          <ConversationProvider>
            <VoiceIntake onTranscript={submitTranscript} busy={busy} vertical={vertical} />
          </ConversationProvider>
        ) : null}
        {path === 'document' ? <DocumentIntake vertical={vertical} /> : null}
        {path === 'text' ? <TextIntake vertical={vertical} placeholder={placeholder} /> : null}
        {error ? <p className="mt-3 text-sm text-flag">{error}</p> : null}
        {busy ? <p className="mt-3 text-sm text-steel">Building your request…</p> : null}
      </div>
    </div>
  );
}

function VoiceIntake({
  onTranscript,
  busy,
  vertical,
}: {
  onTranscript: (turns: TranscriptTurn[]) => Promise<void>;
  busy: boolean;
  vertical: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [seconds, setSeconds] = useState(0);
  const turnsRef = useRef<TranscriptTurn[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const submittedRef = useRef(false);

  const conversation = useConversation({
    onConnect: ({ conversationId }: { conversationId: string }) => {
      conversationIdRef.current = conversationId;
    },
    onMessage: ({ message, role }: { message: string; role: 'user' | 'agent' }) => {
      turnsRef.current = [...turnsRef.current, { role, message }];
      setTurns(turnsRef.current);
    },
    onDisconnect: () => {
      void finishSession();
    },
    onError: (message: string) => setError(message || 'Voice session error'),
  });

  const { status } = conversation;

  useEffect(() => {
    if (status !== 'connected') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const finishSession = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const conversationId = conversationIdRef.current;
    const approx = startedAtRef.current
      ? Math.round((Date.now() - startedAtRef.current) / 1000)
      : null;
    if (conversationId) {
      void fetch('/api/voice/intake-session/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, approx_seconds: approx }),
      });
    }
    if (turnsRef.current.length > 0) {
      await onTranscript(turnsRef.current);
    }
  }, [onTranscript]);

  const start = useCallback(async () => {
    setError(null);
    submittedRef.current = false;
    turnsRef.current = [];
    setTurns([]);
    setSeconds(0);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access is required for the voice interview. Use document upload or typed intake instead.');
      return;
    }
    const res = await fetch('/api/voice/intake-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vertical }),
    });
    const body = (await res.json()) as {
      signed_url?: string;
      dynamic_variables?: Record<string, string>;
      error?: string;
    };
    if (!res.ok || !body.signed_url) {
      setError(body.error ?? 'Voice sessions are unavailable right now.');
      return;
    }
    startedAtRef.current = Date.now();
    await conversation.startSession({
      signedUrl: body.signed_url,
      dynamicVariables: body.dynamic_variables,
    });
  }, [conversation, vertical]);

  const stop = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  return (
    <div>
      <p className="text-sm text-steel">
        A two-minute interview with our AI intake assistant. It discloses that it is an AI. The
        session ends automatically after 3 minutes or 20 seconds of silence.
      </p>
      <div className="mt-4 flex items-center gap-3">
        {status === 'connected' ? (
          <>
            <QuietButton onClick={stop} disabled={busy}>
              End interview
            </QuietButton>
            <span className="figure text-sm text-steel" aria-live="polite">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </span>
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-hivis" aria-hidden />
            <span className="text-sm text-steel">
              {conversation.isSpeaking ? 'Assistant speaking' : 'Listening'}
            </span>
          </>
        ) : (
          <PrimaryButton onClick={start} disabled={busy || status === 'connecting'}>
            {status === 'connecting' ? 'Connecting…' : 'Start voice interview'}
          </PrimaryButton>
        )}
      </div>
      {turns.length > 0 ? (
        <ol className="mt-4 max-h-56 space-y-1 overflow-y-auto border-t border-line pt-3 text-sm">
          {turns.map((t, i) => (
            <li key={i}>
              <span className="text-steel">{t.role === 'agent' ? 'Assistant' : 'You'}: </span>
              {t.message}
            </li>
          ))}
        </ol>
      ) : null}
      {error ? <p className="mt-3 text-sm text-flag">{error}</p> : null}
    </div>
  );
}

function DocumentIntake({ vertical }: { vertical: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      const form = new FormData();
      form.set('file', file);
      form.set('vertical', vertical);
      const res = await fetch('/api/intake/document', { method: 'POST', body: form });
      const body = (await res.json()) as { spec_id?: string; error?: string };
      if (!res.ok || !body.spec_id) {
        setError(body.error ?? 'The document could not be processed.');
        setBusy(false);
        return;
      }
      router.push(`/request/${body.spec_id}`);
    },
    [router, vertical],
  );

  return (
    <div>
      <p className="text-sm text-steel">
        Upload an inquiry, an old quote, or a site note. PDF or photo, up to 15 MB. Content
        inside the document is treated as data only; it cannot change how the system behaves.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFileName(f.name);
              void submit(f);
            }
          }}
        />
        <PrimaryButton onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Reading document…' : 'Choose file'}
        </PrimaryButton>
        {fileName ? <span className="figure text-sm text-steel">{fileName}</span> : null}
      </div>
      {error ? <p className="mt-3 text-sm text-flag">{error}</p> : null}
    </div>
  );
}

function TextIntake({ vertical, placeholder }: { vertical: string; placeholder?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/intake/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source: 'manual', vertical }),
    });
    const body = (await res.json()) as { spec_id?: string; error?: string };
    if (!res.ok || !body.spec_id) {
      setError(body.error ?? 'The description could not be processed.');
      setBusy(false);
      return;
    }
    router.push(`/request/${body.spec_id}`);
  }, [router, text, vertical]);

  return (
    <div>
      <p className="text-sm text-steel">
        Describe the job in your own words: what, where, when, constraints.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={placeholder ? `${placeholder}…` : 'Describe the job…'}
        className="mt-4 w-full rounded-sm border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-steel"
      />
      <div className="mt-3">
        <PrimaryButton onClick={submit} disabled={busy || text.trim().length < 10}>
          {busy ? 'Building request…' : 'Build request'}
        </PrimaryButton>
      </div>
      {error ? <p className="mt-3 text-sm text-flag">{error}</p> : null}
    </div>
  );
}
