/**
 * Tighten the golden voice recordings: cut long thinking pauses out of the
 * audio, keep a natural short gap, and remap every stored timestamp
 * (transcript at_ms / audio_start_s, tool_call at_ms) through the same edit
 * list so tape pins and audio seeking stay aligned.
 *
 * Dry run:  pnpm tsx scripts/tighten-voice-recordings.ts
 * Apply:    pnpm tsx scripts/tighten-voice-recordings.ts --apply
 *
 * Originals are backed up to ~/Downloads/procurecall-audio-backup/ before
 * anything is overwritten.
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { createClient } from '@supabase/supabase-js';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const FFMPEG = 'ffmpeg';

/** A pause longer than this is considered a thinking gap... */
const MIN_SILENCE_S = 1.3;
/** ...and gets compressed down to this. */
const KEEP_S = 0.5;
/** Leading edge kept so words are never clipped. */
const PAD_START_S = 0.3;
const PAD_END_S = 0.2;

const CALL_IDS = [
  'dab61976-052a-4b63-b42a-214227aa9619', // BW Lift
  'c9711cf0-63a8-4557-9afc-ccb10612d985', // Neckar
  '3c10bc69-e8db-4344-b479-1d37d0022439', // Hebetec
];

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

interface Cut {
  from: number;
  to: number;
}

function detectSilences(file: string): Array<{ start: number; end: number }> {
  const res = spawnSync(
    FFMPEG,
    ['-i', file, '-af', 'silencedetect=noise=-32dB:d=0.9', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const stderr = res.stderr ?? '';
  const silences: Array<{ start: number; end: number }> = [];
  let currentStart: number | null = null;
  for (const line of stderr.split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) currentStart = parseFloat(s[1]);
    if (e && currentStart !== null) {
      silences.push({ start: currentStart, end: parseFloat(e[1]) });
      currentStart = null;
    }
  }
  return silences;
}

function audioDuration(file: string): number {
  const res = spawnSync(FFMPEG, ['-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (res.stderr ?? '').match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error('duration not found');
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
}

/** old time (s) -> new time (s) after the cuts. */
function makeMapper(cuts: Cut[]) {
  return (t: number): number => {
    let removed = 0;
    for (const c of cuts) {
      if (t >= c.to) {
        removed += c.to - c.from;
      } else if (t > c.from) {
        removed += t - c.from;
      }
    }
    return Math.max(0, t - removed);
  };
}

function renderCutAudio(input: string, output: string, cuts: Cut[], duration: number) {
  // Kept segments between cuts.
  const segments: Array<{ from: number; to: number }> = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.from > cursor) segments.push({ from: cursor, to: c.from });
    cursor = c.to;
  }
  if (cursor < duration) segments.push({ from: cursor, to: duration });

  const parts = segments
    .map((s, i) => `[0:a]atrim=start=${s.from.toFixed(3)}:end=${s.to.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`)
    .join(';');
  const refs = segments.map((_, i) => `[a${i}]`).join('');
  const filter = `${parts};${refs}concat=n=${segments.length}:v=0:a=1[out]`;

  execFileSync(
    FFMPEG,
    ['-y', '-i', input, '-filter_complex', filter, '-map', '[out]', '-b:a', '128k', output],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

async function main() {
  const backupDir = path.join(homedir(), 'Downloads', 'procurecall-audio-backup');
  mkdirSync(backupDir, { recursive: true });
  const work = path.join(tmpdir(), 'pc-tighten');
  mkdirSync(work, { recursive: true });

  for (const callId of CALL_IDS) {
    const { data: session, error } = await sb
      .from('call_sessions')
      .select('id, recording_url, transcript, tool_calls')
      .eq('id', callId)
      .single();
    if (error || !session?.recording_url) {
      console.log(callId.slice(0, 8), 'SKIP: no session/recording', error?.message ?? '');
      continue;
    }

    const { data: blob, error: dlErr } = await sb.storage
      .from('call-audio')
      .download(session.recording_url);
    if (dlErr || !blob) {
      console.log(callId.slice(0, 8), 'SKIP: download failed', dlErr?.message);
      continue;
    }
    const input = path.join(work, `${callId}.mp3`);
    writeFileSync(input, Buffer.from(await blob.arrayBuffer()));
    writeFileSync(path.join(backupDir, `${callId}.mp3`), readFileSync(input));

    const duration = audioDuration(input);
    const silences = detectSilences(input);
    const cuts: Cut[] = silences
      .filter((s) => s.end - s.start >= MIN_SILENCE_S)
      .map((s) => ({ from: s.start + PAD_START_S, to: s.end - PAD_END_S }))
      .filter((c) => c.to - c.from > MIN_SILENCE_S - KEEP_S - 0.01)
      // Keep KEEP_S of the pause by shrinking the cut window.
      .map((c) => ({ from: c.from, to: c.to - Math.max(0, KEEP_S - PAD_START_S - PAD_END_S) }))
      .filter((c) => c.to > c.from);

    const removedTotal = cuts.reduce((acc, c) => acc + (c.to - c.from), 0);
    console.log(
      `=== ${callId.slice(0, 8)}: duration ${duration.toFixed(1)}s, ${silences.length} silences, ` +
        `${cuts.length} cuts, removing ${removedTotal.toFixed(1)}s -> new ${(duration - removedTotal).toFixed(1)}s`,
    );
    for (const c of cuts) {
      console.log(`   cut ${c.from.toFixed(1)}s..${c.to.toFixed(1)}s (${(c.to - c.from).toFixed(1)}s)`);
    }
    if (cuts.length === 0) {
      console.log('   nothing to tighten');
      continue;
    }
    if (!APPLY) continue;

    const output = path.join(work, `${callId}-tight.mp3`);
    renderCutAudio(input, output, cuts, duration);
    const newDuration = audioDuration(output);
    console.log(`   rendered ${newDuration.toFixed(1)}s`);

    const map = makeMapper(cuts);

    const transcript = (session.transcript as Array<Record<string, unknown>>).map((t) => {
      const oldS =
        typeof t.audio_start_s === 'number' ? (t.audio_start_s as number) : (t.at_ms as number) / 1000;
      const newS = map(oldS);
      return { ...t, audio_start_s: Math.round(newS * 10) / 10, at_ms: Math.round(newS * 1000) };
    });
    const toolCalls = ((session.tool_calls as Array<Record<string, unknown>>) ?? []).map((tc) => {
      if (typeof tc.at_ms !== 'number') return tc;
      return { ...tc, at_ms: Math.round(map((tc.at_ms as number) / 1000) * 1000) };
    });

    const { error: upErr } = await sb.storage
      .from('call-audio')
      .upload(session.recording_url, readFileSync(output), {
        contentType: 'audio/mpeg',
        upsert: true,
      });
    if (upErr) {
      console.log('   UPLOAD FAILED', upErr.message);
      continue;
    }
    const { error: dbErr } = await sb
      .from('call_sessions')
      .update({ transcript, tool_calls: toolCalls })
      .eq('id', callId);
    if (dbErr) {
      console.log('   DB UPDATE FAILED', dbErr.message);
      continue;
    }
    console.log('   applied: audio replaced, timestamps remapped');
  }
  console.log(APPLY ? 'Done.' : 'Dry run only. Re-run with --apply.');
}

void main();
