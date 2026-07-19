/**
 * VOICE END-TO-END VERIFICATION against PRODUCTION — no microphone needed.
 *
 * Proves the whole human-roleplay chain: fresh confirmed spec → voice session
 * (signed URL) → ElevenLabs buyer agent speaks (audio out) → this script
 * plays the dispatcher by streaming TTS audio into the session (audio in →
 * STT → custom-LLM brain with tools) → transcript + tool pins persist →
 * voice-complete pulls the authoritative transcript and the recording into
 * storage → the board serves a playable signed URL.
 *
 * The dispatcher lines here are scripted BECAUSE this is an infrastructure
 * test, not demo material. The golden run is spoken live by the founder.
 *
 * Budget: one short call (~60–90 s). Run once:  pnpm tsx scripts/voice-e2e.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import WebSocket from 'ws';

const BASE = process.env.VOICE_E2E_BASE ?? 'https://procurecall.vercel.app';
const XI = { 'xi-api-key': process.env.ELEVENLABS_API_KEY! };

async function subscriptionSnapshot(label: string) {
  const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: XI });
  const body = (await res.json()) as Record<string, unknown>;
  const interesting = Object.fromEntries(
    Object.entries(body).filter(([k]) =>
      /character|concurren|minutes|usage|tier|status/i.test(k),
    ),
  );
  console.log(`--- subscription ${label} ---`);
  console.log(JSON.stringify(interesting));
  return interesting;
}

/**
 * Dispatcher voice: OpenAI TTS (the ElevenLabs API key is scoped with a
 * 0-character TTS quota; agent sessions run on workspace quota, direct TTS
 * does not). OpenAI returns 24 kHz PCM16 mono; the agent expects 16 kHz, so
 * we resample by index mapping.
 */
async function ttsPcm16(text: string): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'onyx',
      input: text,
      response_format: 'pcm',
    }),
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text()}`);
  const src = Buffer.from(await res.arrayBuffer());
  const srcSamples = Math.floor(src.length / 2);
  const outSamples = Math.floor((srcSamples * 2) / 3); // 24k → 16k
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const srcIdx = Math.min(srcSamples - 1, Math.round(i * 1.5));
    out.writeInt16LE(src.readInt16LE(srcIdx * 2), i * 2);
  }
  return out;
}

// The scripted dispatcher: answers keyed to what the buyer just asked.
function dispatcherReply(buyerLine: string, exchangeCount: number): string | null {
  const line = buyerLine.toLowerCase();
  if (exchangeCount >= 4 || /goodbye|good day|thank you.*that.*(all|everything)/.test(line)) {
    return null; // let the buyer close
  }
  if (/availab|scissor|lift|quote/.test(line) && exchangeCount === 0) {
    return 'Yes, this is the yard. The twelve meter electric lift is available for those dates. The five day rental is six hundred euros net, delivery is ninety euros, pickup is ninety euros.';
  }
  if (/liabilit|insurance|deposit|surcharge|fee/.test(line)) {
    return 'Liability reduction is fourteen euros per day, mandatory. Early delivery before seven is forty five euros. No deposit, no cleaning fee if it comes back swept.';
  }
  if (/total|read.*back|confirm/.test(line)) {
    return 'Yes, that is correct, availability is confirmed for those dates. Send the paperwork.';
  }
  return 'Go ahead, what else do you need?';
}

async function main() {
  const before = await subscriptionSnapshot('BEFORE');

  // 1. Fresh confirmed spec + voice session on production
  const specRes = await fetch(`${BASE}/api/golden/voice-spec`, { method: 'POST' });
  const specBody = (await specRes.json()) as { spec_id?: string; error?: string };
  if (!specBody.spec_id) throw new Error(`voice-spec failed: ${specBody.error}`);
  console.log('spec:', specBody.spec_id);

  const supRes = await fetch(`${BASE}/api/specs/${specBody.spec_id}/board`);
  const board = (await supRes.json()) as { suppliers: Array<{ id: string; name: string }> };
  const supplier = board.suppliers.find((s) => s.name.includes('Hebetec')) ?? board.suppliers[0];
  console.log('supplier:', supplier.name);

  const sessionRes = await fetch(`${BASE}/api/calls/voice-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec_id: specBody.spec_id, supplier_id: supplier.id }),
  });
  const session = (await sessionRes.json()) as {
    call_id?: string;
    signed_url?: string;
    dynamic_variables?: Record<string, string>;
    error?: string;
  };
  if (!session.signed_url || !session.call_id) {
    throw new Error(`voice-session failed: ${session.error}`);
  }
  console.log('call:', session.call_id);

  // 2. The conversation over raw WebSocket
  const ws = new WebSocket(session.signed_url);
  let conversationId: string | null = null;
  let audioOutChunks = 0;
  let audioOutBytes = 0;
  let exchangeCount = 0;
  let closedByUs = false;
  const startedAt = Date.now();
  // Time-to-first-audio measurement: from the end of OUR audio to the first
  // agent audio chunk of the reply.
  let lastDispatcherAudioEndedAt: number | null = null;
  let awaitingReplyAudio = false;
  const ttfaSamples: number[] = [];

  const sendAudio = async (text: string) => {
    const pcm = await ttsPcm16(text).catch((e) => {
      console.error('tts error (turn skipped):', e.message);
      return null;
    });
    if (!pcm) return;
    // stream in ~250 ms chunks (16 kHz * 2 bytes * 0.25 s = 8000 bytes)
    for (let offset = 0; offset < pcm.length; offset += 8000) {
      ws.send(JSON.stringify({ user_audio_chunk: pcm.subarray(offset, offset + 8000).toString('base64') }));
      await new Promise((r) => setTimeout(r, 60));
    }
    // trailing silence so VAD closes the turn
    const silence = Buffer.alloc(8000);
    for (let i = 0; i < 6; i++) {
      ws.send(JSON.stringify({ user_audio_chunk: silence.toString('base64') }));
      await new Promise((r) => setTimeout(r, 60));
    }
    lastDispatcherAudioEndedAt = Date.now();
    awaitingReplyAudio = true;
  };

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      closedByUs = true;
      ws.close();
      resolve();
    }, 110_000);

    ws.on('open', () => {
      console.log('ws open');
      ws.send(
        JSON.stringify({
          type: 'conversation_initiation_client_data',
          dynamic_variables: session.dynamic_variables,
        }),
      );
    });

    ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString()) as {
        type: string;
        conversation_initiation_metadata_event?: {
          conversation_id: string;
          agent_output_audio_format?: string;
          user_input_audio_format?: string;
        };
        agent_response_event?: { agent_response: string };
        audio_event?: { audio_base_64: string };
        ping_event?: { event_id: number };
      };
      if (event.type === 'conversation_initiation_metadata') {
        const meta = event.conversation_initiation_metadata_event!;
        conversationId = meta.conversation_id;
        console.log(
          'conversation:',
          conversationId,
          '| out format:',
          meta.agent_output_audio_format,
          '| in format:',
          meta.user_input_audio_format,
        );
        // Phone reality: the CALLED party answers first. The buyer agent has
        // no first_message by design — it waits for the dispatcher's pickup.
        console.log('DISPATCHER (tts): yard pickup line');
        void sendAudio('Hebetec Arbeitsbühnen Stuttgart, hello? Who am I speaking with?');
      }
      if (event.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', event_id: event.ping_event?.event_id }));
      }
      if (event.type === 'audio') {
        audioOutChunks++;
        audioOutBytes += Buffer.from(event.audio_event!.audio_base_64, 'base64').length;
        if (awaitingReplyAudio && lastDispatcherAudioEndedAt !== null) {
          const ttfa = Date.now() - lastDispatcherAudioEndedAt;
          ttfaSamples.push(ttfa);
          console.log(`time-to-first-audio: ${ttfa} ms`);
          awaitingReplyAudio = false;
        }
      }
      if (event.type === 'agent_response') {
        const buyerLine = event.agent_response_event?.agent_response ?? '';
        console.log(`BUYER: ${buyerLine.slice(0, 140)}`);
        const reply = dispatcherReply(buyerLine, exchangeCount);
        exchangeCount++;
        if (reply === null) {
          console.log('(dispatcher lets the buyer close; ending in 6 s)');
          setTimeout(() => {
            closedByUs = true;
            clearTimeout(timeout);
            ws.close();
            resolve();
          }, 6000);
          return;
        }
        console.log(`DISPATCHER (tts): ${reply.slice(0, 120)}`);
        void sendAudio(reply);
      }
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      console.log(`ws closed ${closedByUs ? '(by us)' : '(by agent)'}`);
      resolve();
    });
    ws.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });

  const callSeconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `audio OUT: ${audioOutChunks} chunks, ${(audioOutBytes / 1024).toFixed(0)} KiB | call ~${callSeconds}s`,
  );
  if (ttfaSamples.length > 0) {
    console.log(
      `time-to-first-audio samples (ms): ${ttfaSamples.join(', ')} | median ${[...ttfaSamples].sort((a, b) => a - b)[Math.floor(ttfaSamples.length / 2)]}`,
    );
  }
  if (!conversationId) throw new Error('no conversation id — initiation failed');

  // 3. Finalize on production
  await new Promise((r) => setTimeout(r, 3000));
  const completeRes = await fetch(`${BASE}/api/calls/${session.call_id}/voice-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: conversationId }),
  });
  const complete = (await completeRes.json()) as {
    ok?: boolean;
    turns?: number;
    recording?: boolean;
    error?: string;
  };
  console.log('voice-complete:', JSON.stringify(complete));

  // 4. Board must serve transcript, pins, and a playable signed recording URL
  const finalBoardRes = await fetch(`${BASE}/api/specs/${specBody.spec_id}/board`);
  const finalBoard = (await finalBoardRes.json()) as {
    sessions: Array<{
      id: string;
      transcript: Array<{ role: string; audio_start_s?: number | null }>;
      tool_calls: Array<{ tool: string }>;
      recording_url: string | null;
      outcome_type: string | null;
    }>;
    quotes: Array<{ call_id: string; status: string; total_after_negotiation_cents: number | null }>;
  };
  const ses = finalBoard.sessions.find((s) => s.id === session.call_id);
  if (!ses) throw new Error('session missing from board');
  const pins = ses.tool_calls.filter((t) => t.tool === 'log_quote_line').length;
  const alignedTurns = ses.transcript.filter((t) => t.audio_start_s !== null && t.audio_start_s !== undefined).length;
  console.log(
    `board: turns=${ses.transcript.length} aligned=${alignedTurns} fee_pins=${pins} outcome=${ses.outcome_type}`,
  );
  const quote = finalBoard.quotes.find((q) => q.call_id === session.call_id);
  if (quote) console.log(`quote: ${quote.status} total=${quote.total_after_negotiation_cents}`);

  if (ses.recording_url) {
    const head = await fetch(ses.recording_url, { method: 'GET', headers: { Range: 'bytes=0-256' } });
    console.log(
      `recording: HTTP ${head.status} content-type=${head.headers.get('content-type')} (playable=${head.ok})`,
    );
  } else {
    console.log('recording: MISSING');
  }

  await subscriptionSnapshot('AFTER');
  console.log('\nE2E VERDICT:', {
    audio_out: audioOutChunks > 0,
    conversation: !!conversationId,
    transcript_persisted: (complete.turns ?? 0) > 0,
    fee_pins: pins > 0,
    recording_playable: !!ses.recording_url,
  });
  console.log('spec for inspection:', `${BASE}/board/${specBody.spec_id}`);
  console.log('subscription before was:', JSON.stringify(before).slice(0, 200));
}

void main();
