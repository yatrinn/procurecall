'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const SESSION_KEY = 'pc-phone-intro-played';

/** Classic handset pictogram (Material "call", 24x24 viewBox). */
const PHONE_PATH =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.24 1.02l-2.2 2.2z';

const CONVERGE_MS = 1100;
const HOLD_MS = 800;
const EXPAND_MS = 1600;
const TOTAL_MS = CONVERGE_MS + HOLD_MS + EXPAND_MS;

interface Particle {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  dirX: number;
  dirY: number;
  dist: number;
  size: number;
  color: string;
  alpha: number;
  delay: number;
  phase: number;
}

function subscribe() {
  return () => {};
}

function readShouldPlay(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return sessionStorage.getItem(SESSION_KEY) !== '1';
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Sample the handset glyph into normalized points in [-0.5, 0.5]. */
function sampleShape(): Array<{ x: number; y: number }> {
  const S = 220;
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
 * One-shot homepage intro: dots converge into a telephone handset pictogram,
 * hold for a beat, then expand from the center across the whole screen and
 * fade out. Plays once per session; skipped under prefers-reduced-motion.
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

    const cx = w / 2;
    const cy = h * 0.44;
    const shapeSize = Math.min(w, h) * 0.5;
    const screenReach = Math.hypot(w, h) * 0.62;

    const particles: Particle[] = sampleShape().map(({ x, y }) => {
      const tx = cx + x * shapeSize;
      const ty = cy + y * shapeSize;
      let dirX = tx - cx;
      let dirY = ty - cy;
      const len = Math.hypot(dirX, dirY) || 1;
      dirX /= len;
      dirY /= len;
      const r = Math.random();
      const color =
        r < 0.05 ? '#c4d600' : r < 0.13 ? 'rgba(90,101,112,1)' : 'rgba(20,24,26,1)';
      return {
        sx: cx + (Math.random() - 0.5) * 36,
        sy: cy + (Math.random() - 0.5) * 36,
        tx,
        ty,
        dirX,
        dirY,
        dist: (0.55 + Math.random() * 0.6) * screenReach,
        size: 1.4 + Math.random() * 1.6,
        color,
        alpha: 0.55 + Math.random() * 0.4,
        delay: Math.random() * 220,
        phase: Math.random() * Math.PI * 2,
      };
    });

    let raf = 0;
    const start = performance.now();

    const frame = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        const t = elapsed - p.delay;
        let x: number;
        let y: number;
        let a: number;
        let s = p.size;

        if (t <= 0) {
          continue;
        } else if (t < CONVERGE_MS) {
          const e = easeOutCubic(t / CONVERGE_MS);
          x = p.sx + (p.tx - p.sx) * e;
          y = p.sy + (p.ty - p.sy) * e;
          a = p.alpha * Math.min(1, t / 300);
        } else if (t < CONVERGE_MS + HOLD_MS) {
          const wob = Math.sin(now / 320 + p.phase) * 0.9;
          x = p.tx + wob;
          y = p.ty + wob * 0.6;
          a = p.alpha;
        } else {
          const et = Math.min(1, (t - CONVERGE_MS - HOLD_MS) / EXPAND_MS);
          const e = easeOutCubic(et);
          x = p.tx + p.dirX * p.dist * e;
          y = p.ty + p.dirY * p.dist * e;
          a = p.alpha * (1 - et);
          s = p.size * (1 - et * 0.4);
        }

        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(x, y, s, s);
      }
      ctx.globalAlpha = 1;

      if (elapsed < TOTAL_MS + 300) {
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
      className="pointer-events-none fixed inset-0 z-50"
      aria-hidden
    />
  );
}
