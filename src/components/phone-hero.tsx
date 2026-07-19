'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const SESSION_KEY = 'pc-phone-intro-played';

function subscribe() {
  return () => {};
}

function readIntroNeeded(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return sessionStorage.getItem(SESSION_KEY) !== '1';
}

/**
 * One-shot hero mark: a handset that rings in once, then sits still.
 * Interactive tilt after the intro. No ambient loop (DESIGN_SYSTEM.md).
 */
export function PhoneHero() {
  const rootRef = useRef<HTMLDivElement>(null);
  const needsIntro = useSyncExternalStore(subscribe, readIntroNeeded, () => false);
  const [finished, setFinished] = useState(false);
  const phase = needsIntro && !finished ? 'intro' : 'settled';

  useEffect(() => {
    if (!needsIntro || finished) return;
    const settle = window.setTimeout(() => {
      sessionStorage.setItem(SESSION_KEY, '1');
      setFinished(true);
    }, 1600);
    return () => window.clearTimeout(settle);
  }, [needsIntro, finished]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || phase !== 'settled') return;

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.setProperty('--tilt-x', `${(-y * 8).toFixed(2)}deg`);
      el.style.setProperty('--tilt-y', `${(x * 10).toFixed(2)}deg`);
    };
    const onLeave = () => {
      el.style.setProperty('--tilt-x', '0deg');
      el.style.setProperty('--tilt-y', '0deg');
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [phase]);

  return (
    <div ref={rootRef} className={`phone-hero phone-hero--${phase}`} aria-hidden>
      <div className="phone-hero__stage">
        <div className="phone-hero__glow" />
        <svg
          className="phone-hero__handset"
          viewBox="0 0 160 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M78 118 C 70 140, 92 155, 84 178"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.35"
          />
          <rect
            x="38"
            y="28"
            width="44"
            height="72"
            rx="22"
            transform="rotate(-28 60 64)"
            fill="var(--ink)"
          />
          <rect
            x="46"
            y="40"
            width="28"
            height="48"
            rx="14"
            transform="rotate(-28 60 64)"
            fill="var(--paper)"
            opacity="0.18"
          />
          <rect
            x="86"
            y="96"
            width="44"
            height="72"
            rx="22"
            transform="rotate(22 108 132)"
            fill="var(--ink)"
          />
          <rect
            x="94"
            y="108"
            width="28"
            height="48"
            rx="14"
            transform="rotate(22 108 132)"
            fill="var(--paper)"
            opacity="0.18"
          />
          <path
            d="M72 88 C 78 102, 88 112, 102 118"
            stroke="var(--ink)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <circle cx="58" cy="52" r="5" fill="var(--hivis)" />
        </svg>

        <span className="phone-hero__chip phone-hero__chip--a">€570</span>
        <span className="phone-hero__chip phone-hero__chip--b">€500</span>
        <span className="phone-hero__chip phone-hero__chip--c">on tape</span>
      </div>
    </div>
  );
}
