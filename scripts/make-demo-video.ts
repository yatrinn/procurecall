/**
 * Renders the product-demo video (~57s): a real browser walkthrough
 * (request -> confirm -> negotiation board -> decision room), with the
 * ACTUAL recorded golden-run call audio mixed in during the two board
 * segments. Every other segment is silent by design — the founder records
 * his own narration afterward and this script's job is only to produce a
 * picture-locked base to talk over (same pattern as the tech video, except
 * there the narration was TTS; here the founder's voice IS the narration).
 *
 * Real audio clips (14s each, extracted from ElevenLabs recordings, judged
 * by transcript content):
 *  - BW Lift: t=168..182s of the call — the 600->570 concession + read-back
 *  - Neckar:  t=75..89s of the call — the "100 x 5 = 500" confirmation
 *
 * Run: pnpm tsx scripts/make-demo-video.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, copyFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const WORK = '/tmp/pc-demo-video/render';
const PROD = 'https://procurecall.vercel.app';
const GOLDEN_SPEC = 'e323df1f-1d71-4617-9e2a-bef7e36c614f';

const TITLE_SECONDS = 1.4;
const TITLE_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><body style="margin:0;background:#F4F2ED;color:#1A1A1A;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="text-align:left;max-width:900px">
<div style="font-size:64px;font-weight:700;letter-spacing:-0.02em">ProcureCall</div>
<div style="font-size:24px;margin-top:16px;color:#4A4A45">One brief. Every supplier. The best verified deal.</div>
</div></body></html>`)}`;

interface Scene {
  id: string;
  seconds: number;
  narrationHint: string;
  /** Path to a real-audio clip (wav) to place under this scene, if any. */
  audioClip?: string;
  run: (page: Page) => Promise<void>;
}

const CLIP_DIR = '/tmp/pc-demo-video';

const SCENES: Scene[] = [
  {
    id: 's1-request',
    seconds: 6,
    narrationHint:
      'One brief. A twelve-meter electric scissor lift, five days, delivered Monday before seven a.m.',
    run: async (page) => {
      await page.goto(`${PROD}/request`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      // The tab buttons set role="tab" explicitly (see intake-panel.tsx) —
      // getByRole('button', ...) never matches them.
      await page.getByRole('tab', { name: 'Type it' }).click({ timeout: 5000 });
      await page.waitForTimeout(300);
      const textarea = page.locator('textarea').first();
      await textarea.waitFor({ state: 'visible', timeout: 5000 });
      await textarea.fill(
        '12-meter electric scissor lift, indoor and outdoor use, paved ground, 5 business days, delivered to Koenigstrasse 10, 70173 Stuttgart before 7am on 2026-07-27, pickup 2026-07-31, no operator, 230V on site, supplier liability reduction preferred.',
      );
      await page.waitForTimeout(400);
    },
  },
  {
    id: 's2-confirm',
    seconds: 6.5,
    narrationHint:
      "I confirm it once. The request freezes under this fingerprint — every supplier call has to cite exactly this job, or the system rejects it.",
    run: async (page) => {
      await page.getByRole('button', { name: 'Build request' }).click({ timeout: 5000 });
      await page.waitForURL(/\/request\/[0-9a-f-]{36}$/, { timeout: 20000 });
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: 'Confirm request' }).click({ timeout: 8000 });
      await page.waitForTimeout(1200);
    },
  },
  {
    id: 's3-board-bwlift',
    seconds: 14.4,
    narrationHint:
      'BW Lift opened at six hundred. Watch the tape — the agent pushes for a sharper number, and the supplier agrees on the spot: five hundred seventy, all in, confirmed on the call.',
    audioClip: path.join(CLIP_DIR, 'clip-bwlift.wav'),
    run: async (page) => {
      await page.goto(`${PROD}/board/${GOLDEN_SPEC}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      await page.mouse.wheel(0, 250);
      await page
        .getByText(/Transcript \(\d+ turns\)/)
        .nth(2)
        .click({ timeout: 2000 })
        .catch(() => undefined);
      await page.waitForTimeout(300);
      // Turn 12 = supplier, ~170s: "570 all in total" — right inside the clip window.
      await clickTapeTurn(page, 'dab61976-052a-4b63-b42a-214227aa9619', 12);
    },
  },
  {
    id: 's4-board-neckar',
    seconds: 14.4,
    narrationHint:
      "Neckar's headline is cheaper still — five hundred, all in, confirmed the same way. But the engine already knows that number is suspiciously low against the market.",
    audioClip: path.join(CLIP_DIR, 'clip-neckar.wav'),
    run: async (page) => {
      await page.mouse.wheel(0, -250);
      await page
        .getByText(/Transcript \(\d+ turns\)/)
        .nth(1)
        .click({ timeout: 2000 })
        .catch(() => undefined);
      await page.waitForTimeout(300);
      // Turn 6 = supplier, ~76s: "split all equally five times hundred" — inside the clip window.
      await clickTapeTurn(page, 'c9711cf0-63a8-4557-9afc-ccb10612d985', 6);
    },
  },
  {
    id: 's5-decision',
    seconds: 7.3,
    narrationHint:
      'The decision room ranks deterministically. Neckar is cheapest but flagged below the market benchmark — never auto-preferred. BW Lift is the clean runner-up, flagged instead for conditional-fee exposure. Every figure links back to the second it was spoken.',
    run: async (page) => {
      await page.goto(`${PROD}/decision/${GOLDEN_SPEC}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      await page.evaluate(() => window.scrollBy({ top: 380, behavior: 'smooth' }));
    },
  },
  {
    id: 's6-ranked-decline',
    seconds: 7,
    narrationHint:
      'And Hebetec? It declined — no truck available — recorded honestly as a decline, never forced into a fake quote. One brief, three real calls, the best verified deal.',
    run: async (page) => {
      await page.evaluate(() => window.scrollBy({ top: 550, behavior: 'smooth' }));
      await page.waitForTimeout(1400);
      await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
    },
  },
];

/**
 * Chromium's autoplay policy blocks script-only `el.play()` without a real
 * user gesture. The Call Tape's own turn-block buttons already call the
 * app's `selectTurn` -> seeks the tape's audio to that turn AND scrolls the
 * matching transcript line into view — a real Playwright click on one is a
 * genuine gesture AND is the exact interaction the product is built around,
 * so it's more reliable than driving the <audio> element directly.
 */
async function clickTapeTurn(page: Page, callId: string, turnIndex: number): Promise<void> {
  const turnButton = page.locator(
    `[aria-label="Call tape ${callId}"] [data-tape-turn="${turnIndex}"]`,
  );
  await turnButton.waitFor({ state: 'attached', timeout: 4000 }).catch(() => undefined);
  await turnButton.click({ timeout: 4000 }).catch(() => undefined);
}

function ffprobeDuration(file: string): number {
  const out = execFileSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]).toString().trim();
  return parseFloat(out);
}

async function main() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  for (const s of SCENES) {
    if (s.audioClip && !existsSync(s.audioClip)) {
      throw new Error(`missing real-audio clip for ${s.id}: ${s.audioClip}`);
    }
  }

  const total = TITLE_SECONDS + SCENES.reduce((a, s) => a + s.seconds, 0);
  console.log('planned total:', total.toFixed(1) + 's');
  if (total > 58) throw new Error(`over budget: ${total.toFixed(1)}s`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: WORK, size: { width: 1920, height: 1080 } },
    deviceScaleFactor: 1,
    permissions: [],
  });
  const page = await context.newPage();

  await page.goto(TITLE_HTML);
  await page.waitForTimeout(TITLE_SECONDS * 1000);

  // Actual (not planned) durations drive the audio timeline below, so a slow
  // network/LLM call can never desync picture from sound.
  const actualSeconds = new Map<string, number>();
  for (const scene of SCENES) {
    const t0 = Date.now();
    await scene.run(page);
    const spent = (Date.now() - t0) / 1000;
    const hold = Math.max(0, scene.seconds - spent);
    await page.waitForTimeout(hold * 1000);
    const actual = spent + hold;
    actualSeconds.set(scene.id, actual);
    console.log(
      `${scene.id}: setup ${spent.toFixed(1)}s + hold ${hold.toFixed(1)}s = ${actual.toFixed(1)}s (planned ${scene.seconds}s)`,
    );
  }

  await context.close();
  await browser.close();
  const webm = readdirSync(WORK).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('no video produced');
  const videoIn = path.join(WORK, webm);
  console.log('recorded video:', ffprobeDuration(videoIn).toFixed(1) + 's');

  // Audio: silence everywhere except the two real-call-audio windows.
  const segmentFiles: string[] = [];
  let cursor = TITLE_SECONDS;
  const timeline: Array<{ id: string; start: number; end: number; narrationHint: string; hasRealAudio: boolean }> = [];
  // silent title card
  {
    const f = path.join(WORK, 'seg-title.wav');
    execFileSync(FFMPEG, [
      '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', TITLE_SECONDS.toFixed(3), f,
    ]);
    segmentFiles.push(f);
  }
  for (const s of SCENES) {
    const window = actualSeconds.get(s.id) ?? s.seconds;
    const f = path.join(WORK, `seg-${s.id}.wav`);
    if (s.audioClip) {
      // Real clip is exactly 14.0s; pad/trim to the ACTUAL scene window so it
      // never runs past the moment the picture moves to the next scene.
      execFileSync(FFMPEG, [
        '-y', '-i', s.audioClip, '-af', `apad=whole_dur=${window.toFixed(3)},atrim=0:${window.toFixed(3)}`,
        '-ar', '44100', '-ac', '2', f,
      ]);
    } else {
      execFileSync(FFMPEG, [
        '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', window.toFixed(3), f,
      ]);
    }
    segmentFiles.push(f);
    timeline.push({
      id: s.id,
      start: cursor,
      end: cursor + window,
      narrationHint: s.narrationHint,
      hasRealAudio: !!s.audioClip,
    });
    cursor += window;
  }
  const concatList = path.join(WORK, 'concat.txt');
  writeFileSync(concatList, segmentFiles.map((f) => `file '${f}'`).join('\n'));
  const audioAll = path.join(WORK, 'audio.wav');
  execFileSync(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, audioAll]);
  console.log('audio track:', ffprobeDuration(audioAll).toFixed(1) + 's');

  const outFinal = path.join(WORK, 'procurecall-demo.mp4');
  execFileSync(FFMPEG, [
    '-y', '-i', videoIn, '-i', audioAll,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', '58', '-movflags', '+faststart',
    outFinal,
  ]);

  const downloads = path.join(homedir(), 'Downloads');
  copyFileSync(outFinal, path.join(downloads, 'procurecall-demo.mp4'));

  const sheet = [
    'ProcureCall product-demo video — picture-locked base, your voice to be added',
    '',
    'This file already contains REAL call audio (the golden voice run) during the',
    'two board segments below — do not talk over those two windows, or talk much',
    'quieter under them. Everywhere else is silent: speak the narration hint at a',
    'natural pace, roughly filling that window.',
    '',
    ...timeline.map(
      (t) =>
        `${t.start.toFixed(1).padStart(5)}s\u2013${t.end.toFixed(1).padEnd(6)}s  ${t.id}${t.hasRealAudio ? '  [REAL CALL AUDIO PLAYS \u2014 pause or speak quietly]' : ''}\n    "${t.narrationHint}"`,
    ),
    '',
    'To record your own narration: play this file, read the hints out loud at the',
    'right moments (a mirror/teleprompter app helps), record just your voice, then',
    'send me the audio file like last time and I will mix + re-mux the final cut.',
  ].join('\n');
  writeFileSync(path.join(downloads, 'procurecall-demo-narration-guide.txt'), sheet);

  console.log('FINAL:', path.join(downloads, 'procurecall-demo.mp4'), ffprobeDuration(outFinal).toFixed(1) + 's');
}

void main();
