/**
 * Microphone helpers. iOS Safari never lets a website open Settings or skip
 * the mic prompt — we only call getUserMedia so Safari can show Allow itself.
 */

export type MicAccessResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'unknown'; message: string };

export function stopMediaStream(stream: MediaStream | null | undefined) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

/**
 * Call only from a tap/click. Always hits getUserMedia so Safari can show its
 * own Allow sheet — we never trust permissions.query (it false-blocks on iOS).
 */
export async function requestMicrophoneAccess(): Promise<MicAccessResult> {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'unsupported', message: 'Microphone is only available in the browser.' };
  }
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason: 'insecure',
      message: 'Microphone needs a secure (https) connection.',
    };
  }
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'This browser cannot use the microphone.',
    };
  }

  try {
    // Plain { audio: true } is the most reliable prompt on iOS Safari.
    const stream = await media.getUserMedia({ audio: true });
    return { ok: true, stream };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return {
        ok: false,
        reason: 'denied',
        message: 'Safari blocked the microphone for this site.',
      };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return { ok: false, reason: 'unavailable', message: 'No microphone found on this device.' };
    }
    return {
      ok: false,
      reason: 'unknown',
      message: 'Microphone did not open. Tap the button again.',
    };
  }
}
