'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const SESSION_KEY = 'pc-phone-intro-played';

/** Classic handset pictogram (Material "call", 24x24 viewBox). */
const PHONE_PATH =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.24 1.02l-2.2 2.2z';

const BLOOM_MS = 1000; // center cluster blooms into the handset
const HOLD_MS = 900; // handset breathes in place
const EXPAND_MS = 1700; // radial expansion across the screen
const TOTAL_MS = BLOOM_MS + HOLD_MS + EXPAND_MS;

interface Particle {
  tx: number;
  ty: number;
  dirX: number;
  dirY: number;
  reach: number;
  r: number;
  color: string;
  alpha: number;
  delay: number;
  phase: number;
  swirl: number;
}

function subscribe() {
  return () => {};
}

function readShouldPlay(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return sessionStorage.getItem(SESSION_KEY) !== '1';
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Sample the handset glyph into normalized points in [-0.5, 0.5]. */
function sampleShape(): Array<{ x: number; y: number }> {
  const S = 240;
  const off = document.createElement('canvas');
  off.width = S;
  off.height = S;
  const ctx = off.getContext('2d');
  if (!ctx) return [];
  ctx.scale(S / 24, S / 24);
  ctx.fill(new Path2D(PHONE_PATH));
  const data = ctx.getImageData(0, 0, S, S).data;
  const points: Array<{ x: number; y: number }> = [];
  const step = 4;
  for (let py = 0; py < S; py += step) {
    for (let px = 0; px < S; px += step) {
      if (data[(py * S + px) * 4 + 3] > 128) {
        points.push({ x: px / S - 0.5, y: py / S - 0.5 });
      }
    }
  }
  return points;
}

/**
 * One-shot homepage intro: a point cloud blooms from the center of the screen
 * into a telephone handset pictogram, breathes for a beat, then expands
 * radially in every direction and dissolves. Plays once per session; skipped
 * under prefers-reduced-motion.
 */
export function PhoneCloudIntro() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shouldPlay = useSyncExternalStore(subscribe, readShouldPlay, () => false);
  const [finished, setFinished] = useState(false);
  const active = shouldPlay && !finished;

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // True screen center: the cloud must grow out of the middle.
    const cx = w / 2;
    const cy = h / 2;
    const shapeSize = Math.min(w, h) * 0.46;
    // Far corner distance so the expansion covers the whole screen evenly.
    const screenReach = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.15;

    const particles: Particle[] = sampleShape().map(({ x, y }) => {
      const tx = cx + x * shapeSize;
      const ty = cy + y * shapeSize;
      // Radial direction from screen center through the particle's shape
      // position, with a touch of jitter so rays do not look mechanical.
      const jitter = 0.22;
      let dirX = (tx - cx) / (shapeSize * 0.5) + (Math.random() - 0.5) * jitter;
      let dirY = (ty - cy) / (shapeSize * 0.5) + (Math.random() - 0.5) * jitter;
      const len = Math.hypot(dirX, dirY) || 1;
      dirX /= len;
      dirY /= len;
      const r = Math.random();
      const color = r < 0.06 ? '#c4d600' : r < 0.16 ? '#5a6570' : '#14181a';
      return {
        tx,
        ty,
        dirX,
        dirY,
        reach: (0.5 + Math.random() * 0.65) * screenReach,
        r: 1.1 + Math.random() * 1.5,
        color,
        alpha: 0.5 + Math.random() * 0.45,
        delay: Math.random() * 180,
        phase: Math.random() * Math.PI * 2,
        swirl: (Math.random() - 0.5) * 0.5,
      };
    });

    let raf = 0;
    const start = performance.now();

    const frame = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        const t = elapsed - p.delay;
        if (t <= 0) continue;

        let x: number;
        let y: number;
        let a: number;
        let radius = p.r;

        if (t < BLOOM_MS) {
          // Bloom: from a tight cluster at the exact center out to the shape.
          const e = easeOutCubic(t / BLOOM_MS);
          x = cx + (p.tx - cx) * e;
          y = cy + (p.ty - cy) * e;
          a = p.alpha * Math.min(1, t / 260);
        } else if (t < BLOOM_MS + HOLD_MS) {
          // Hold: the handset breathes very slightly.
          const wob = Math.sin(now / 380 + p.phase);
          x = p.tx + wob * 0.8;
          y = p.ty + Math.cos(now / 420 + p.phase) * 0.8;
          a = p.alpha;
        } else {
          // Expand: radial, eased, with a soft swirl; fades out at the edge.
          const et = Math.min(1, (t - BLOOM_MS - HOLD_MS) / EXPAND_MS);
          const e = easeInOutCubic(et);
          const d = p.reach * e;
          const ang = p.swirl * e;
          const dx = p.dirX * Math.cos(ang) - p.dirY * Math.sin(ang);
          const dy = p.dirX * Math.sin(ang) + p.dirY * Math.cos(ang);
          x = p.tx + dx * d;
          y = p.ty + dy * d;
          a = p.alpha * (1 - easeInOutCubic(et) * 0.35 - et * et * 0.65);
          radius = p.r * (1 - et * 0.35);
        }

        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (elapsed < TOTAL_MS + 250) {
        raf = requestAnimationFrame(frame);
      } else {
        sessionStorage.setItem(SESSION_KEY, '1');
        setFinished(true);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50 h-full w-full"
      aria-hidden
    />
  );
}
