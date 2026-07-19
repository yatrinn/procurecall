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
          {/* Classic handset silhouette */}
          <path
            d="M48 36
               C 40 36, 34 44, 36 54
               L 42 78
               C 44 86, 52 90, 60 88
               L 72 84
               C 78 82, 84 86, 86 92
               L 96 128
               C 98 134, 94 140, 88 142
               L 64 150
               C 54 154, 48 164, 52 174
               L 58 188
               C 62 198, 74 200, 82 192
               L 118 156
               C 126 148, 128 136, 122 126
               L 98 78
               C 94 70, 96 60, 104 56
               L 126 46
               C 136 42, 140 30, 132 22
               L 120 12
               C 112 6, 100 8, 94 16
               L 70 48
               C 66 54, 58 54, 52 50
               L 48 36 Z"
            fill="var(--ink)"
          />
          <path
            d="M58 48 L 78 36 C 84 32, 92 34, 96 40 L 108 58"
            stroke="var(--paper)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.22"
          />
          <path
            d="M70 150 L 92 138 C 98 134, 106 136, 110 142 L 124 160"
            stroke="var(--paper)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.22"
          />
          <circle cx="54" cy="42" r="5" fill="var(--hivis)" />
          {/* Cord */}
          <path
            d="M96 168 C 108 178, 102 188, 114 192"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.35"
          />
        </svg>

        <span className="phone-hero__chip phone-hero__chip--a">€570</span>
        <span className="phone-hero__chip phone-hero__chip--b">€500</span>
        <span className="phone-hero__chip phone-hero__chip--c">on tape</span>
      </div>
    </div>
  );
}
