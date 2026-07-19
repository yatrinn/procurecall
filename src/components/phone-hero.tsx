'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const SESSION_KEY = 'pc-phone-intro-played';

/** Classic handset pictogram (Material "call", 24x24 viewBox). */
const PHONE_PATH =
  'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.24 1.02l-2.2 2.2z';

const BLOOM_MS = 1000; // center cluster blooms into the handset
const HOLD_MS = 1100; // handset breathes in place
const EXPAND_MS = 1900; // spreads across the screen
const LINGER_MS = 22000; // dispersed field drifts, reacts to the pointer, fades
const TOTAL_MS = BLOOM_MS + HOLD_MS + EXPAND_MS + LINGER_MS;

// Stainless-steel palette; the accent stays rare.
const STEEL_COLORS: Array<{ color: string; weight: number }> = [
  { color: '#9aa3ab', weight: 0.52 },
  { color: '#7d8790', weight: 0.26 },
  { color: '#b9c0c6', weight: 0.13 },
  { color: '#5a6570', weight: 0.05 },
  { color: '#c4d600', weight: 0.04 },
];

function pickColor(): string {
  let r = Math.random();
  for (const { color, weight } of STEEL_COLORS) {
    if (r < weight) return color;
    r -= weight;
  }
  return STEEL_COLORS[0].color;
}

interface Particle {
  tx: number; // handset position
  ty: number;
  fx: number; // dispersed field position after expansion
  fy: number;
  r: number;
  color: string;
  alpha: number;
  delay: number;
  phase: number;
  driftX: number; // slow drift during the linger phase (px/s)
  driftY: number;
  wobbleAmp: number;
  wobbleSpeed: number;
  pushX: number; // smoothed pointer repulsion
  pushY: number;
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
 * One-shot homepage intro: a stainless-steel point cloud blooms from the
 * center into a telephone handset, breathes, then disperses across the whole
 * screen where it lingers as a quiet drifting field that leans away from the
 * pointer and slowly dissolves over ~25 seconds. Plays once per session;
 * skipped under prefers-reduced-motion.
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
    const cy = h / 2;
    const shapeSize = Math.min(w, h) * 0.46;

    const particles: Particle[] = sampleShape().map(({ x, y }) => {
      const tx = cx + x * shapeSize;
      const ty = cy + y * shapeSize;
      // Field position: radially outward from the center through the shape
      // position, distributed so the whole screen is covered but the dots
      // stay on screen (that is what makes the field linger, not vanish).
      const jitter = 0.3;
      let dirX = (tx - cx) / (shapeSize * 0.5) + (Math.random() - 0.5) * jitter;
      let dirY = (ty - cy) / (shapeSize * 0.5) + (Math.random() - 0.5) * jitter;
      const len = Math.hypot(dirX, dirY) || 1;
      dirX /= len;
      dirY /= len;
      const spread = 0.2 + Math.random() * 0.85;
      const fx = cx + dirX * spread * (w / 2) * 0.96 + (Math.random() - 0.5) * 40;
      const fy = cy + dirY * spread * (h / 2) * 0.96 + (Math.random() - 0.5) * 40;
      return {
        tx,
        ty,
        fx: Math.max(8, Math.min(w - 8, fx)),
        fy: Math.max(8, Math.min(h - 8, fy)),
        r: 1.0 + Math.random() * 1.5,
        color: pickColor(),
        alpha: 0.55 + Math.random() * 0.4,
        delay: Math.random() * 180,
        phase: Math.random() * Math.PI * 2,
        driftX: (Math.random() - 0.5) * 7,
        driftY: (Math.random() - 0.5) * 7,
        wobbleAmp: 2 + Math.random() * 5,
        wobbleSpeed: 0.00025 + Math.random() * 0.00035,
        pushX: 0,
        pushY: 0,
      };
    });

    // Pointer interaction: the field gently leans away from the cursor.
    const pointer = { x: -9999, y: -9999 };
    const onPointerMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const REPEL_RADIUS = 150;
    const REPEL_STRENGTH = 34;

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
        } else if (t < BLOOM_MS + HOLD_MS + EXPAND_MS) {
          // Expand: glide out to the dispersed field position.
          const et = (t - BLOOM_MS - HOLD_MS) / EXPAND_MS;
          const e = easeInOutCubic(et);
          x = p.tx + (p.fx - p.tx) * e;
          y = p.ty + (p.fy - p.ty) * e;
          a = p.alpha * (1 - 0.45 * e);
        } else {
          // Linger: a quiet field that drifts, wobbles, leans away from the
          // pointer, and dissolves over LINGER_MS.
          const lt = Math.min(1, (t - BLOOM_MS - HOLD_MS - EXPAND_MS) / LINGER_MS);
          const seconds = (t - BLOOM_MS - HOLD_MS - EXPAND_MS) / 1000;
          const bx =
            p.fx + p.driftX * seconds + Math.sin(now * p.wobbleSpeed + p.phase) * p.wobbleAmp;
          const by =
            p.fy +
            p.driftY * seconds +
            Math.cos(now * p.wobbleSpeed * 1.13 + p.phase) * p.wobbleAmp;

          const dx = bx - pointer.x;
          const dy = by - pointer.y;
          const dist = Math.hypot(dx, dy);
          let targetPushX = 0;
          let targetPushY = 0;
          if (dist < REPEL_RADIUS && dist > 0.001) {
            const force = (1 - dist / REPEL_RADIUS) * REPEL_STRENGTH;
            targetPushX = (dx / dist) * force;
            targetPushY = (dy / dist) * force;
          }
          p.pushX += (targetPushX - p.pushX) * 0.08;
          p.pushY += (targetPushY - p.pushY) * 0.08;

          x = bx + p.pushX;
          y = by + p.pushY;
          // Ease from the post-expansion level down to zero, slightly faster
          // toward the end so the exit feels deliberate, not abrupt.
          a = p.alpha * 0.55 * (1 - lt) * (1 - lt * 0.4);
          radius = p.r * (1 - lt * 0.25);
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
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
    };
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
