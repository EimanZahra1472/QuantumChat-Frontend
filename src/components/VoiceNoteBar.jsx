import { useEffect } from 'react';
import { Pause, Play, Send, Square, Trash2 } from 'lucide-react';
import VoicePlayer from './VoicePlayer.jsx';

function formatVoiceTimer(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function VoiceNoteBar({
  phase,
  seconds = 0,
  levels = [],
  paused = false,
  previewUrl,
  previewMeta,
  maxSeconds = 60,
  sending = false,
  onCancel,
  onStop,
  onDiscard,
  onSend,
  onTogglePause,
}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.isComposing || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        if (!sending) onSend?.();
      } else if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        if (!sending) {
          if (phase === 'preview') onDiscard?.();
          else onCancel?.();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, sending, onSend, onCancel, onDiscard]);

  if (phase === 'preview' && previewUrl) {
    return (
      <div className="composer composer-recording is-preview" role="region" aria-label="Review voice note">
        <button
          type="button"
          className="attach-button voice-cancel-btn"
          onClick={onDiscard}
          title="Delete voice note"
          aria-label="Delete voice note"
          disabled={sending}
        >
          <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="voice-preview-player">
          <VoicePlayer
            url={previewUrl}
            isMine
            waveform={previewMeta?.waveform}
            durationSeconds={previewMeta?.durationSeconds}
          />
        </div>

        <button
          type="button"
          className="send-button voice-send-btn"
          onClick={onSend}
          title="Send voice note"
          aria-label="Send voice note"
          disabled={sending}
        >
          <Send size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`composer composer-recording ${paused ? 'is-paused' : ''}`}
      role="region"
      aria-label="Recording voice note"
    >
      <button
        type="button"
        className="attach-button voice-cancel-btn"
        onClick={onCancel}
        title="Discard recording"
        aria-label="Discard recording"
        disabled={sending}
      >
        <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
      </button>

      <div className="voice-recording-status">
        <span className={`voice-recording-dot ${paused ? 'is-paused' : ''}`} />
        <div className="voice-live-bars" aria-hidden="true">
          {levels.map((h, i) => (
            <span
              key={i}
              className={`voice-live-bar ${paused ? 'is-paused' : ''}`}
              style={{ height: `${Math.max(12, h)}%` }}
            />
          ))}
        </div>
        <span className="voice-recording-time">
          {paused ? 'Paused' : 'Recording'} {formatVoiceTimer(seconds)}
        </span>
        <span className="voice-recording-hint">max {maxSeconds}s</span>
      </div>

      <div className="voice-recording-actions">
        <button
          type="button"
          className="attach-button voice-pause-btn"
          onClick={onTogglePause}
          title={paused ? 'Resume recording' : 'Pause recording'}
          aria-label={paused ? 'Resume recording' : 'Pause recording'}
          disabled={sending}
        >
          {paused ? <Play size={16} strokeWidth={2} /> : <Pause size={16} strokeWidth={2} />}
        </button>

        <button
          type="button"
          className="attach-button voice-review-btn"
          onClick={onStop}
          title="Listen before sending"
          aria-label="Listen before sending"
          disabled={sending}
        >
          <Square size={13} fill="currentColor" strokeWidth={0} />
        </button>

        <button
          type="button"
          className="send-button voice-send-btn"
          onClick={onSend}
          title="Send voice note"
          aria-label="Send voice note"
          disabled={sending}
        >
          <Send size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
