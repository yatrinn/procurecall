'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HANDSET_POINTS } from './phone-handset-points';

const BLOOM_MS = 900;
const HOLD_MS = 1000;
const EXPAND_MS = 1600;
const LINGER_MS = 14000;
const TOTAL_MS = BLOOM_MS + HOLD_MS + EXPAND_MS + LINGER_MS;
const REDUCED_TOTAL_MS = 2200;

/** Peak opacity while the handset is fully formed (before it settles). */
const FORMED_ALPHA = 0.72;
/** Watermark opacity after expand — text stays readable underneath. */
const WATERMARK_ALPHA = 0.16;

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
  nx: number;
  ny: number;
  r: number;
  color: string;
  alpha: number;
  delay: number;
  phase: number;
  wobbleAmp: number;
  wobbleSpeed: number;
  pushX: number;
  pushY: number;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function viewportSize(): { w: number; h: number } {
  const vv = window.visualViewport;
  return {
    w: Math.max(1, Math.floor(vv?.width ?? window.innerWidth)),
    h: Math.max(1, Math.floor(vv?.height ?? window.innerHeight)),
  };
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Homepage intro: stainless-steel points bloom into a telephone handset on
 * every visit to Overview. Drawn behind page content so copy stays readable.
 */
export function PhoneCloudIntro() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mounted = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);
  const [finished, setFinished] = useState(false);
  const active = mounted && !finished;

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    let { w, h } = viewportSize();
    const isNarrow = w < 640;
    const dpr = Math.min(window.devicePixelRatio || 1, isNarrow ? 1.5 : 2);

    const resizeCanvas = () => {
      ({ w, h } = viewportSize());
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();

    // Formed handset: centered, readable as a pictogram.
    const formedSize = () => Math.min(w, h) * (isNarrow ? 0.5 : 0.42);
    const formedCx = () => w / 2;
    const formedCy = () => h * (isNarrow ? 0.42 : 0.45);

    // Settled watermark: same silhouette, larger, parked so hero copy on the
    // left stays clear (desktop) / sits softly behind the upper band (mobile).
    const settledSize = () => Math.min(w, h) * (isNarrow ? 0.72 : 0.62);
    const settledCx = () => (isNarrow ? w * 0.55 : w * 0.72);
    const settledCy = () => (isNarrow ? h * 0.22 : h * 0.36);

    const stride = isNarrow ? 2 : 1;
    const shape = HANDSET_POINTS.filter((_, i) => i % stride === 0);
    if (shape.length === 0) return;

    const particles: Particle[] = shape.map(([nx, ny]) => ({
      nx,
      ny,
      r: (isNarrow ? 1.5 : 1.05) + Math.random() * (isNarrow ? 1.4 : 1.2),
      color: pickColor(),
      alpha: 0.85 + Math.random() * 0.15,
      delay: Math.random() * (isNarrow ? 80 : 140),
      phase: Math.random() * Math.PI * 2,
      wobbleAmp: 0.6 + Math.random() * 1.2,
      wobbleSpeed: 0.0002 + Math.random() * 0.00025,
      pushX: 0,
      pushY: 0,
    }));

    const pointer = { x: -9999, y: -9999 };
    const onPointer = (e: PointerEvent | TouchEvent) => {
      if ('touches' in e) {
        const t = e.touches[0];
        if (!t) return;
        pointer.x = t.clientX;
        pointer.y = t.clientY;
      } else {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
      }
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('touchstart', onPointer, { passive: true });
    window.addEventListener('touchmove', onPointer, { passive: true });
    window.addEventListener('resize', resizeCanvas, { passive: true });
    window.visualViewport?.addEventListener('resize', resizeCanvas);

    const REPEL_RADIUS = isNarrow ? 90 : 120;
    const REPEL_STRENGTH = 14;
    const duration = reduced ? REDUCED_TOTAL_MS : TOTAL_MS;

    let raf = 0;
    const start = performance.now();

    const handsetPoint = (nx: number, ny: number, size: number, ox: number, oy: number) => ({
      x: ox + nx * size,
      y: oy + ny * size,
    });

    const frame = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, w, h);

      const fSize = formedSize();
      const fCx = formedCx();
      const fCy = formedCy();
      const sSize = settledSize();
      const sCx = settledCx();
      const sCy = settledCy();

      for (const p of particles) {
        const t = elapsed - p.delay;
        if (t <= 0) continue;

        let x: number;
        let y: number;
        let a: number;
        let radius = p.r;

        if (reduced) {
          const fadeIn = Math.min(1, t / 400);
          const fadeOut =
            t > REDUCED_TOTAL_MS - 600 ? 1 - (t - (REDUCED_TOTAL_MS - 600)) / 600 : 1;
          const pt = handsetPoint(p.nx, p.ny, fSize, fCx, fCy);
          x = pt.x;
          y = pt.y;
          a = FORMED_ALPHA * p.alpha * easeOutCubic(fadeIn) * Math.max(0, fadeOut);
        } else if (t < BLOOM_MS) {
          // Bloom from center into the handset silhouette.
          const e = easeOutCubic(t / BLOOM_MS);
          const pt = handsetPoint(p.nx, p.ny, fSize, fCx, fCy);
          x = fCx + (pt.x - fCx) * e;
          y = fCy + (pt.y - fCy) * e;
          a = FORMED_ALPHA * p.alpha * Math.min(1, t / 220);
        } else if (t < BLOOM_MS + HOLD_MS) {
          const pt = handsetPoint(p.nx, p.ny, fSize, fCx, fCy);
          const wob = Math.sin(now / 420 + p.phase);
          x = pt.x + wob * 0.5;
          y = pt.y + Math.cos(now / 460 + p.phase) * 0.5;
          a = FORMED_ALPHA * p.alpha;
        } else if (t < BLOOM_MS + HOLD_MS + EXPAND_MS) {
          // Settle: same silhouette, larger + shifted — never a scatter field.
          const et = (t - BLOOM_MS - HOLD_MS) / EXPAND_MS;
          const e = easeInOutCubic(et);
          const size = fSize + (sSize - fSize) * e;
          const ox = fCx + (sCx - fCx) * e;
          const oy = fCy + (sCy - fCy) * e;
          const pt = handsetPoint(p.nx, p.ny, size, ox, oy);
          x = pt.x;
          y = pt.y;
          const alphaTarget = FORMED_ALPHA + (WATERMARK_ALPHA - FORMED_ALPHA) * e;
          a = alphaTarget * p.alpha;
          radius = p.r * (1 + 0.15 * e);
        } else {
          // Linger as a quiet watermark of the handset, then dissolve.
          const lt = Math.min(1, (t - BLOOM_MS - HOLD_MS - EXPAND_MS) / LINGER_MS);
          const pt = handsetPoint(p.nx, p.ny, sSize, sCx, sCy);
          const bx = pt.x + Math.sin(now * p.wobbleSpeed + p.phase) * p.wobbleAmp;
          const by = pt.y + Math.cos(now * p.wobbleSpeed * 1.1 + p.phase) * p.wobbleAmp;

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
          p.pushX += (targetPushX - p.pushX) * 0.06;
          p.pushY += (targetPushY - p.pushY) * 0.06;

          x = bx + p.pushX;
          y = by + p.pushY;
          // Ease out gently; stay readable as a shape until late fade.
          a = WATERMARK_ALPHA * p.alpha * (1 - lt) * (1 - lt * 0.35);
          radius = p.r * 1.15 * (1 - lt * 0.2);
        }

        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (elapsed < duration + 250) {
        raf = requestAnimationFrame(frame);
      } else {
        setFinished(true);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('touchstart', onPointer);
      window.removeEventListener('touchmove', onPointer);
      window.removeEventListener('resize', resizeCanvas);
      window.visualViewport?.removeEventListener('resize', resizeCanvas);
    };
  }, [active]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[1] h-[100dvh] w-full"
      aria-hidden
    />
  );
}
