/**
 * Renders the 58-second tech video end to end:
 * 1. narration segments via OpenAI TTS (the ElevenLabs key has a 0-credit
 *    direct-TTS quota; agent sessions are unaffected)
 * 2. scene durations derived from measured audio lengths
 * 3. Playwright records the scripted browser journey (1080p)
 * 4. ffmpeg muxes video + narration into H.264/AAC MP4 (≤ 58 s)
 *
 * Output: ~/Downloads/procurecall-tech.mp4 (+ -silent.mp4 + timing sheet)
 * Run: pnpm tsx scripts/make-tech-video.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const WORK = '/tmp/pc-tech-video/render';
const PROD = 'https://procurecall.vercel.app';
const GH = 'https://github.com/yatrinn/procurecall/blob/main';

const TITLE_SECONDS = 1.6;
const TITLE_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><body style="margin:0;background:#F4F2ED;color:#1A1A1A;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="text-align:left;max-width:900px">
<div style="font-size:64px;font-weight:700;letter-spacing:-0.02em">ProcureCall</div>
<div style="font-size:24px;margin-top:16px;color:#4A4A45">The negotiator that cannot lie &mdash; how it&rsquo;s built.</div>
<div style="font-size:16px;margin-top:28px;color:#8A897F">procurecall.vercel.app &middot; github.com/yatrinn/procurecall</div>
</div></body></html>`)}`;

interface Scene {
  id: string;
  narration: string;
  url: string;
  minSeconds: number;
  run?: (page: Page) => Promise<void>;
}

const SCENES: Scene[] = [
  {
    id: 's1-truth-layer',
    narration:
      'The buyer agent cannot invent competing bids — it is never handed an unverified number. The only path is this server tool: six checks, or a typed error.',
    url: `${GH}/src/core/truth-layer.ts#L47-L71`,
    minSeconds: 8,
  },
  {
    id: 's2-lever-gate',
    narration:
      "Permissions match: an unauthorized lever's tool simply doesn't exist for the session.",
    url: `${GH}/src/negotiation/buyer-tools.ts#L226-L240`,
    minSeconds: 5,
  },
  {
    id: 's3-policies',
    narration:
      'Suppliers are not scripts — each runs a private price sheet, floor, and concession ladder, enforced in code.',
    url: `${GH}/data/supplier-policies/equipment-rental-stuttgart.json#L64-L80`,
    minSeconds: 5.5,
  },
  {
    id: 's4-voice-board',
    narration:
      'The same brain drives live voice through ElevenLabs. Every fee is pinned to the second it was spoken, on a playable recording.',
    url: `${PROD}/board/435cffab-b7b2-4e21-8f33-658db364cf97`,
    minSeconds: 8,
    run: async (page) => {
      await page.waitForTimeout(2200);
      await page
        .getByText(/Transcript \(\d+ turns\)/)
        .first()
        .click({ timeout: 3000 })
        .catch(() => undefined);
      await page.waitForTimeout(600);
      // start recording playback so the scrubber visibly moves
      await page
        .evaluate(() => {
          const a = document.querySelector('audio');
          if (a) void a.play();
        })
        .catch(() => undefined);
    },
  },
  {
    id: 's5-engine-decision',
    narration:
      'Money is engine math: guaranteed cost, conditional exposure, deposits as cash — and a benchmark that flags lowballs.',
    url: `${PROD}/decision/1251040d-6b6d-4ab0-a726-1616dbc599c0`,
    minSeconds: 8,
    run: async (page) => {
      await page.waitForTimeout(2500);
      await page.evaluate(() => window.scrollBy({ top: 420, behavior: 'smooth' }));
    },
  },
  {
    id: 's6-lab',
    narration:
      'Fifty-five adversarial scenarios with real results — and a public console where anyone can try to make it lie.',
    url: `${PROD}/lab`,
    minSeconds: 8,
    run: async (page) => {
      await page.waitForTimeout(1800);
      await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
      await page.waitForTimeout(2200);
      await page.evaluate(() => window.scrollBy({ top: 650, behavior: 'smooth' }));
    },
  },
  {
    id: 's7-vertical-swap',
    narration:
      'And verticals are pure configuration — rental to U.S. moving in one click. Honesty is the product.',
    url: `${PROD}/request`,
    minSeconds: 7.5,
    run: async (page) => {
      await page.waitForTimeout(2600);
      await page
        .getByRole('link', { name: 'Residential moving — US' })
        .click({ timeout: 3000 })
        .catch(() => undefined);
    },
  },
];

function ffprobeDuration(file: string): number {
  const out = execFileSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]).toString().trim();
  return parseFloat(out);
}

async function tts(text: string, file: string): Promise<number> {
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
      response_format: 'mp3',
      speed: 1.15,
      instructions:
        'Calm, confident technical narrator for a product engineering video. Measured pace, precise articulation, quietly assured — never salesy.',
    }),
  });
  if (!res.ok) throw new Error(`tts failed: ${res.status} ${await res.text()}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return ffprobeDuration(file);
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  // 1. narration + measured durations
  const durations: number[] = [];
  for (const scene of SCENES) {
    const file = path.join(WORK, `${scene.id}.mp3`);
    const d = await tts(scene.narration, file);
    durations.push(d);
    console.log(`${scene.id}: ${d.toFixed(2)}s narration`);
  }

  // scene hold times: in-window delay + narration + small tail;
  // scene 1's window also spans the title card, whose audio delay nearly cancels that head start
  const sceneSeconds = SCENES.map((s, i) => {
    const delaySec = i === 0 ? TITLE_SECONDS - 0.2 : 0.25;
    const needed = delaySec + durations[i] + 0.45 - (i === 0 ? TITLE_SECONDS : 0);
    return Math.max(s.minSeconds, needed);
  });
  const total = TITLE_SECONDS + sceneSeconds.reduce((a, b) => a + b, 0);
  console.log('planned total:', total.toFixed(1) + 's');
  if (total > 57.5) {
    const overshoot = total - 57.5;
    for (let i = 0; i < sceneSeconds.length; i++) {
      // floor = narration + segment delay + tail, so padded audio never exceeds the scene window
      const delaySec = i === 0 ? TITLE_SECONDS - 0.2 : 0.25;
      const audioFloor = durations[i] + delaySec + 0.2 - (i === 0 ? TITLE_SECONDS : 0);
      const slack = sceneSeconds[i] - Math.max(3, audioFloor);
      const cut = Math.min(Math.max(0, slack), overshoot * (sceneSeconds[i] / total));
      sceneSeconds[i] -= cut;
    }
    const trimmed = TITLE_SECONDS + sceneSeconds.reduce((a, b) => a + b, 0);
    console.log('trimmed total:', trimmed.toFixed(1) + 's');
    if (trimmed > 58) {
      throw new Error(
        `narration too long for 58s (${trimmed.toFixed(1)}s) — shorten texts or raise speed`,
      );
    }
  }

  // 2. record the browser journey
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: WORK, size: { width: 1920, height: 1080 } },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto(TITLE_HTML);
  await page.waitForTimeout(TITLE_SECONDS * 1000);

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const t0 = Date.now();
    await page.goto(scene.url, { waitUntil: 'domcontentloaded' });
    if (scene.url.includes('github.com')) await page.waitForTimeout(800);
    if (scene.run) await scene.run(page);
    const spent = (Date.now() - t0) / 1000;
    await page.waitForTimeout(Math.max(0, sceneSeconds[i] - spent) * 1000);
    console.log(`${scene.id}: scene closed at ${sceneSeconds[i].toFixed(1)}s (page work ${spent.toFixed(1)}s)`);
  }

  await context.close();
  await browser.close();
  const webm = readdirSync(WORK).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('no video produced');
  const videoIn = path.join(WORK, webm);
  console.log('recorded video:', ffprobeDuration(videoIn).toFixed(1) + 's');

  // 3. audio: pad each segment to its scene window, then concatenate
  const paddedFiles: string[] = [];
  for (let i = 0; i < SCENES.length; i++) {
    const window = i === 0 ? TITLE_SECONDS + sceneSeconds[0] : sceneSeconds[i];
    const delayMs = i === 0 ? Math.round((TITLE_SECONDS - 0.2) * 1000) : 250;
    const inFile = path.join(WORK, `${SCENES[i].id}.mp3`);
    const outFile = path.join(WORK, `${SCENES[i].id}.wav`);
    execFileSync(FFMPEG, [
      '-y', '-i', inFile,
      '-af', `adelay=${delayMs}|${delayMs},apad=whole_dur=${window.toFixed(3)},atrim=0:${window.toFixed(3)}`,
      '-ar', '44100', '-ac', '2', outFile,
    ]);
    paddedFiles.push(outFile);
  }
  const concatList = path.join(WORK, 'concat.txt');
  writeFileSync(concatList, paddedFiles.map((f) => `file '${f}'`).join('\n'));
  const audioAll = path.join(WORK, 'narration.wav');
  execFileSync(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, audioAll]);
  console.log('narration track:', ffprobeDuration(audioAll).toFixed(1) + 's');

  // 4. mux to MP4, hard-capped at 58 s
  const outFinal = path.join(WORK, 'procurecall-tech.mp4');
  execFileSync(FFMPEG, [
    '-y', '-i', videoIn, '-i', audioAll,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k',
    '-t', '58', '-movflags', '+faststart',
    outFinal,
  ]);
  const outSilent = path.join(WORK, 'procurecall-tech-silent.mp4');
  execFileSync(FFMPEG, [
    '-y', '-i', videoIn, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-r', '30', '-an', '-t', '58', '-movflags', '+faststart', outSilent,
  ]);

  const downloads = path.join(homedir(), 'Downloads');
  copyFileSync(outFinal, path.join(downloads, 'procurecall-tech.mp4'));
  copyFileSync(outSilent, path.join(downloads, 'procurecall-tech-silent.mp4'));

  let cursor = TITLE_SECONDS;
  const rows = SCENES.map((s, i) => {
    const start = i === 0 ? 0 : cursor;
    const end = (i === 0 ? 0 : cursor) + (i === 0 ? TITLE_SECONDS + sceneSeconds[0] : sceneSeconds[i]);
    cursor = end;
    return `${start.toFixed(1).padStart(5)}s–${end.toFixed(1).padEnd(6)}s  ${s.id}\n    ${s.narration}`;
  });
  writeFileSync(
    path.join(downloads, 'procurecall-tech-timing.txt'),
    `ProcureCall tech video — scene timing and narration\n(voice: OpenAI TTS "onyx"; swap by re-recording over procurecall-tech-silent.mp4)\n\n${rows.join('\n\n')}\n`,
  );

  console.log('FINAL:', path.join(downloads, 'procurecall-tech.mp4'), ffprobeDuration(outFinal).toFixed(1) + 's');
}

void main();
