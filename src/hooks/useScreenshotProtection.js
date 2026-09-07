import { useEffect, useRef } from 'react';

/**
 * Best-effort screenshot / screen-capture protection for the web app.
 *
 * Applied on the viewer's device when viewing content from someone who enabled
 * screenshot protection — not on the account owner's own device.
 *
 * Browsers cannot fully block OS screenshots. This hook only:
 * - Flashes a privacy overlay on known screenshot shortcuts (PrintScreen / macOS)
 * - Briefly blurs UI while the tab is actually hidden (visibilitychange)
 *
 * It does NOT blur on window focus loss — that fires constantly (DevTools,
 * OS notifications, clicking outside the browser) and made the app unusable.
 *
 * Mobile apps use FLAG_SECURE / iOS capture APIs for stronger enforcement.
 */
export function useScreenshotProtection(enabled, { onAttempt, scope = 'chat' } = {}) {
  const onAttemptRef = useRef(onAttempt);
  onAttemptRef.current = onAttempt;
  const flashTimerRef = useRef(null);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;

    const root = document.documentElement;
    root.classList.add('qc-screenshot-protection');
    root.dataset.qcProtectScope = scope;
    // Never leave a stale blur from a previous session / focus race.
    root.classList.remove('qc-screenshot-blur');

    function flashPrivacyOverlay(reason) {
      let overlay = document.getElementById('qc-screenshot-flash');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'qc-screenshot-flash';
        overlay.className = 'qc-screenshot-flash';
        overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(overlay);
      }
      overlay.classList.add('is-active');
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        overlay.classList.remove('is-active');
      }, 900);
      onAttemptRef.current?.(reason || 'screenshot');
    }

    function isScreenshotChord(e) {
      const key = e.key || '';
      const code = e.code || '';
      // Windows / Linux PrintScreen
      if (key === 'PrintScreen' || code === 'PrintScreen') return true;
      // Windows Snipping Tool (Win+Shift+S) — the most common modern
      // Windows screenshot method, previously undetected entirely. The OS
      // shell intercepts this before the page in some configurations, so
      // this still won't catch every case — but it does fire as a normal
      // keydown in enough real-world setups to be worth listening for.
      if (e.shiftKey && !e.ctrlKey && !e.altKey) {
        const k = key.toLowerCase();
        if ((k === 's' || code === 'KeyS') && (e.metaKey || e.getModifierState?.('Meta') || e.getModifierState?.('OS'))) {
          return true;
        }
      }
      // macOS: Cmd+Shift+3/4/5 (full / selection / recording)
      // Do not treat Ctrl+Shift+S as a screenshot — browsers use it for Save.
      if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
        const k = key.toLowerCase();
        if (k === '3' || k === '4' || k === '5') return true;
        if (code === 'Digit3' || code === 'Digit4' || code === 'Digit5') return true;
      }
      return false;
    }

    function onKeyDown(e) {
      if (!isScreenshotChord(e)) return;
      flashPrivacyOverlay('screenshot');
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        root.classList.add('qc-screenshot-blur');
      } else {
        root.classList.remove('qc-screenshot-blur');
      }
    }

    // Safety net: if blur somehow sticks while the tab is visible, clear it.
    function clearStaleBlur() {
      if (document.visibilityState === 'visible') {
        root.classList.remove('qc-screenshot-blur');
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', clearStaleBlur);
    document.addEventListener('pointerdown', clearStaleBlur, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', clearStaleBlur);
      document.removeEventListener('pointerdown', clearStaleBlur, true);
      root.classList.remove('qc-screenshot-protection', 'qc-screenshot-blur');
      delete root.dataset.qcProtectScope;
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      document.getElementById('qc-screenshot-flash')?.remove();
    };
  }, [enabled, scope]);
}
