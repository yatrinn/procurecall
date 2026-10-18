import type { TapePin, TapeTurn } from '@/components/call-tape';

export interface ReplaySession {
  id: string;
  supplier_name: string;
  supplier_location: string | null;
  behavior_label: string;
  turns: TapeTurn[];
  pins: TapePin[];
  duration_ms: number;
  outcome_line: string;
  quote_before_cents: number | null;
  quote_after_cents: number | null;
  /** Signed URL of the call recording (voice runs). */
  audio_url: string | null;
  currency: string;
}
