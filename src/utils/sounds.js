let audioCtx = null;
let unlocked = false;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Call once after a user gesture so later background sounds are allowed. */
export function unlockAudio() {
  if (typeof window === 'undefined' || unlocked) return;
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume()
        .then(() => {
          unlocked = true;
        })
        .catch(() => {});
    } else {
      unlocked = true;
    }
    // Tiny silent buffer helps some browsers keep the context alive.
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // ignore
  }
}

function tone({ frequency, duration, type = 'sine', volume = 0.08, stagger = 0 }) {
  const ctx = getCtx();
  if (!ctx) return;

  const start = ctx.currentTime + stagger;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Soft rising blip after a successful send. */
export function playSendSound() {
  try {
    unlockAudio();
    tone({ frequency: 660, duration: 0.07, type: 'triangle', volume: 0.06 });
    tone({ frequency: 880, duration: 0.09, type: 'triangle', volume: 0.05, stagger: 0.06 });
  } catch {
    // ignore autoplay / unsupported audio
  }
}

/** Soft two-tone chime for an incoming message. volumeScale is 0–1 (defaults to full volume). */
export function playReceiveSound(volumeScale = 1) {
  const scale = Number.isFinite(volumeScale) ? Math.max(0, Math.min(1, volumeScale)) : 1;
  if (scale <= 0) return;
  try {
    unlockAudio();
    tone({ frequency: 520, duration: 0.09, type: 'sine', volume: 0.07 * scale });
    tone({ frequency: 780, duration: 0.12, type: 'sine', volume: 0.06 * scale, stagger: 0.08 });
  } catch {
    // ignore
  }
}

/**
 * Starts a soft repeating ringback tone while an outgoing call is dialing.
 * Returns a cleanup function that immediately silences every active tone.
 */
export function startDialingSound() {
  unlockAudio();
  const ctx = getCtx();
  if (!ctx) return () => {};

  let stopped = false;
  let timer = null;
  const active = new Set();

  function ring() {
    if (stopped) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const low = ctx.createOscillator();
    const high = ctx.createOscillator();

    low.type = 'sine';
    high.type = 'sine';
    low.frequency.setValueAtTime(440, now);
    high.frequency.setValueAtTime(480, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.025);
    gain.gain.setValueAtTime(0.035, now + 1.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);

    low.connect(gain);
    high.connect(gain);
    gain.connect(ctx.destination);
    low.start(now);
    high.start(now);
    low.stop(now + 1.32);
    high.stop(now + 1.32);

    const nodes = { low, high, gain };
    active.add(nodes);
    high.onended = () => active.delete(nodes);
    timer = window.setTimeout(ring, 3_200);
  }

  ring();

  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
    for (const { low, high, gain } of active) {
      try {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0.0001, now, 0.01);
        low.stop(now + 0.05);
        high.stop(now + 0.05);
      } catch {
        // Nodes may already have stopped naturally.
      }
    }
    active.clear();
  };
}

/**
 * Repeating ringtone for an incoming call (callee side).
 * Returns a cleanup function.
 */
export function startIncomingRingSound(volumeScale = 0.8) {
  unlockAudio();
  const ctx = getCtx();
  if (!ctx) return () => {};

  const scale = Number.isFinite(volumeScale) ? Math.max(0, Math.min(1, volumeScale)) : 0.8;
  if (scale <= 0) return () => {};

  let stopped = false;
  let timer = null;
  const active = new Set();

  function ringBurst() {
    if (stopped) return;
    const now = ctx.currentTime;
    const vol = 0.055 * scale;

    for (let i = 0; i < 3; i += 1) {
      const start = now + i * 0.22;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(i % 2 === 0 ? 660 : 840, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
      const nodes = { osc, gain };
      active.add(nodes);
      osc.onended = () => active.delete(nodes);
    }

    timer = window.setTimeout(ringBurst, 2_400);
  }

  ringBurst();

  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
    for (const { osc, gain } of active) {
      try {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0.0001, now, 0.01);
        osc.stop(now + 0.05);
      } catch {
        // ignore
      }
    }
    active.clear();
  };
}

/** Short chime before auto-playing the next voice note. */
export function playVoiceAdvanceSound() {
  try {
    unlockAudio();
    tone({ frequency: 740, duration: 0.06, type: 'sine', volume: 0.045 });
    tone({ frequency: 980, duration: 0.08, type: 'triangle', volume: 0.04, stagger: 0.05 });
  } catch {
    // ignore
  }
}
