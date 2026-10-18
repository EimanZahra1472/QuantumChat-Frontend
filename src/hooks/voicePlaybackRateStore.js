const ALLOWED_RATES = [0.5, 1, 1.5, 2];
const CYCLE_RATES = [1, 1.5, 2];
const STORAGE_KEY = 'quantumchat.voicePlaybackRate';

/**
 * Read the persisted playback rate from localStorage.
 * Returns a validated rate or 1 as fallback.
 */
export function readStoredRate() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return 1;
    const parsed = Number(raw);
    return ALLOWED_RATES.includes(parsed) ? parsed : 1;
  } catch {
    return 1;
  }
}

/**
 * Write a playback rate to localStorage (only if it's an allowed value).
 * Returns the validated rate that was stored.
 */
export function writeStoredRate(rate) {
  const validated = ALLOWED_RATES.includes(rate) ? rate : 1;
  try {
    localStorage.setItem(STORAGE_KEY, String(validated));
  } catch {
    // localStorage unavailable — silently ignore
  }
  return validated;
}

/** WhatsApp-style pill tap: 1x → 1.5x → 2x → 1x. */
export function cyclePlaybackRate(current) {
  const idx = CYCLE_RATES.indexOf(Number(current));
  if (idx === -1) return CYCLE_RATES[0];
  return CYCLE_RATES[(idx + 1) % CYCLE_RATES.length];
}

export { ALLOWED_RATES, CYCLE_RATES, STORAGE_KEY };
