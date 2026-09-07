import { useEffect, useRef, useState } from 'react';
import useVoicePlaybackRate from '../hooks/useVoicePlaybackRate.js';

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function VoiceSpeedControl({ rate, setRate, allowedRates }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const optionRefs = useRef([]);

  const toggleOpen = (e) => {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  const handleSelect = (newRate, e) => {
    e?.stopPropagation();
    setRate(newRate);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const selectedIndex = allowedRates.indexOf(rate);
      const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
      setTimeout(() => {
        optionRefs.current[targetIndex]?.focus();
      }, 0);
    }
  }, [isOpen, rate, allowedRates]);

  const handleMenuKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const currentIndex = optionRefs.current.findIndex(
        (el) => el && el === document.activeElement
      );
      let nextIndex = 0;
      if (e.key === 'ArrowDown') {
        nextIndex = currentIndex < allowedRates.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : allowedRates.length - 1;
      }
      optionRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div className="voice-speed-control" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className="voice-speed-btn"
        onClick={toggleOpen}
        aria-label="Playback speed"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {rate}×
      </button>

      {isOpen && (
        <div
          className="voice-speed-menu"
          role="listbox"
          aria-label="Playback speed options"
          onKeyDown={handleMenuKeyDown}
        >
          {allowedRates.map((r, idx) => {
            const isSelected = r === rate;
            return (
              <button
                key={r}
                ref={(el) => (optionRefs.current[idx] = el)}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`voice-speed-option ${isSelected ? 'selected' : ''}`}
                onClick={(e) => handleSelect(r, e)}
              >
                {r}×
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Reusable voice/audio message player with playback-speed control.
 *
 * Supports:
 *  - Normal DM & group audio
 *  - View-once DM & group audio
 *  - Playback speed selection (0.5×, 1×, 1.5×, 2×) persisted in localStorage
 *  - WebM infinite-duration workaround
 *  - At-most-once burn callback via onPlayedThrough
 *  - Auto-play (for view-once group audio)
 *  - Cleanup on URL change / unmount
 *
 * @param {{ url: string, onPlayedThrough?: () => void, autoPlay?: boolean }} props
 */
export default function VoicePlayer({ url, onPlayedThrough, autoPlay = false }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const burnedRef = useRef(false);
  const fixingDurationRef = useRef(false);
  const autoPlayedRef = useRef(false);
  const { rate, setRate, ALLOWED_RATES } = useVoicePlaybackRate();

  // Pause & reset when the blob URL changes or the component unmounts.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, [url]);

  // Apply playbackRate to the HTMLAudioElement whenever it changes.
  // This works while playing and while paused — it does NOT reset
  // currentTime, progress, duration, or playback state.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, [rate]);

  function maybeBurn() {
    if (burnedRef.current) return;
    burnedRef.current = true;
    onPlayedThrough?.();
  }

  // MediaRecorder webm blobs (Chrome/Android) don't carry a real duration
  // header — audio.duration comes back Infinity/NaN on loadedmetadata.
  // Standard workaround: seek to a huge time, which forces the browser to
  // resolve the true duration, then seek back to 0.
  function fixInfiniteDuration(audio) {
    if (fixingDurationRef.current) return;
    fixingDurationRef.current = true;
    audio.currentTime = 1e101;
    const onTimeUpdate = () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.currentTime = 0;
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      fixingDurationRef.current = false;

      // If autoPlay was requested, start playback after duration is resolved.
      if (autoPlay && !autoPlayedRef.current) {
        autoPlayedRef.current = true;
        audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
  }

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (audio.paused) {
        await audio.play();
        setPlaying(true);
      } else {
        audio.pause();
        setPlaying(false);
      }
    } catch {
      setPlaying(false);
    }
  }

  function handleLoadedMetadata(e) {
    const audio = e.currentTarget;
    // Sync playbackRate on the fresh audio element.
    audio.playbackRate = rate;
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) {
      setDuration(d);
      // autoPlay for view-once group audio
      if (autoPlay && !autoPlayedRef.current) {
        autoPlayedRef.current = true;
        audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
    } else {
      fixInfiniteDuration(audio);
    }
  }

  // WhatsApp-style: show total duration at rest, count up elapsed while playing.
  const displaySeconds = playing || currentTime > 0 ? currentTime : duration;

  return (
    <div className="voice-player">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (fixingDurationRef.current) return; // ignore the seek-probe tick
          setCurrentTime(a.currentTime);
          setProgress(a.duration && Number.isFinite(a.duration) ? a.currentTime / a.duration : 0);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setCurrentTime(0);
          maybeBurn();
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <button type="button" className="voice-play-btn" onClick={togglePlay} aria-label={playing ? 'Pause voice note' : 'Play voice note'}>
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,4 20,12 6,20" />
          </svg>
        )}
      </button>
      <div className="voice-wave">
        <div className="voice-wave-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} />
      </div>
      <span className="voice-duration">{formatDuration(displaySeconds)}</span>
      <VoiceSpeedControl rate={rate} setRate={setRate} allowedRates={ALLOWED_RATES} />
    </div>
  );
}
