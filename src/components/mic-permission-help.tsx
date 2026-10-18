'use client';

import type { MicAccessResult } from '@/lib/microphone';
import { QuietButton } from '@/components/form';

/**
 * Compact recovery when the system mic prompt was dismissed or blocked.
 * Websites cannot open iPhone Settings — only Safari's own Allow sheet can.
 */
export function MicPermissionHelp({
  result,
  onRetry,
}: {
  result: Extract<MicAccessResult, { ok: false }> | null;
  onRetry: () => void;
  /** @deprecated kept optional so old call sites still typecheck */
  contextLine?: string;
}) {
  if (!result) return null;

  return (
    <div className="mt-3 max-w-md text-sm">
      <p className="text-flag">{result.message}</p>
      <p className="mt-1 text-steel">
        Tap below again — Safari should ask Allow. If it does not, open the aA menu in the
        address bar → Website Settings → Microphone → Allow.
      </p>
      <div className="mt-3">
        <QuietButton type="button" onClick={onRetry}>
          Allow microphone
        </QuietButton>
      </div>
    </div>
  );
}
