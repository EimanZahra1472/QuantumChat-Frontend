import { useEffect, useRef, useState, useMemo } from 'react';
import { Mic, Pause, Play } from 'lucide-react';
import useVoicePlaybackRate from '../hooks/useVoicePlaybackRate.js';
import { cyclePlaybackRate } from '../hooks/voicePlaybackRateStore.js';
import {
  notifyVoiceEnded,
  registerVoicePlayer,
  unregisterVoicePlayer,
} from '../utils/voicePlaybackQueue.js';
import { normalizeWaveform } from '../utils/voiceMessage.js';
import UserAvatar from './UserAvatar.jsx';

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function generateWaveformBars(seedStr, count = 28) {
  let hash = 0;
  for (let i = 0; i < (seedStr || '').length; i++) {
    hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
    hash |= 0;
  }
  const bars = [];
  for (let i = 0; i < count; i++) {
    const pseudo = Math.abs(Math.sin(hash + i * 1.43) * 0.55 + Math.cos(i * 0.77) * 0.45);
    const heightPct = Math.round(20 + pseudo * 80);
    bars.push(Math.max(20, Math.min(100, heightPct)));
  }
  return bars;
}

export default function VoicePlayer({
  url,
  onPlayedThrough,
  isMine = false,
  autoPlay = false,
  waveform,
  durationSeconds,
  messageId,
  listened = false,
  senderAvatar,
  onListened,
}) {
  const audioRef = useRef(null);
  const waveTrackRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(
    Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0,
  );
  const [currentTime, setCurrentTime] = useState(0);
  const burnedRef = useRef(false);
  const fixingDurationRef = useRef(false);
  const autoPlayedRef = useRef(false);
  const listenedSentRef = useRef(false);
  const { rate, setRate } = useVoicePlaybackRate();

  const bars = useMemo(() => {
    const real = normalizeWaveform(waveform, 24);
    if (real?.length) return real.map((n) => Math.max(12, n));
    return generateWaveformBars(url, 24);
  }, [url, waveform]);

  useEffect(() => {
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      setDuration(durationSeconds);
    }
  }, [durationSeconds]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, [url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    if (!messageId) return undefined;
    registerVoicePlayer(messageId, {
      play: async () => {
        const audio = audioRef.current;
        if (!audio) return;
        await audio.play();
        setPlaying(true);
      },
      pause: () => audioRef.current?.pause(),
    });
    return () => unregisterVoicePlayer(messageId);
  }, [messageId, url]);

  function maybeBurn() {
    if (burnedRef.current) return;
    burnedRef.current = true;
    onPlayedThrough?.();
  }

  function markListened() {
    if (isMine || listenedSentRef.current) return;
    listenedSentRef.current = true;
    onListened?.();
  }

  function fixInfiniteDuration(audio) {
    if (fixingDurationRef.current) return;
    if (Number.isFinite(duration) && duration > 0) return;
    fixingDurationRef.current = true;
    audio.currentTime = 1e101;
    const onTimeUpdate = () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.currentTime = 0;
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      fixingDurationRef.current = false;
      if (autoPlay && !autoPlayedRef.current) {
        autoPlayedRef.current = true;
        audio.play().catch(() => {});
      }
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
  }

  async function togglePlay(e) {
    e?.stopPropagation?.();
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

  function handleSeek(e) {
    e?.stopPropagation?.();
    const audio = audioRef.current;
    const track = waveTrackRef.current;
    if (!audio || !track) return;
    const rect = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const knownDuration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : duration;
    const targetTime = ratio * (knownDuration || 0);
    if (Number.isFinite(targetTime)) {
      audio.currentTime = targetTime;
      setCurrentTime(targetTime);
      setProgress(ratio);
    }
  }

  const displaySeconds = playing || currentTime > 0 ? currentTime : duration;

  return (
    <div className={`voice-player-modern ${isMine ? 'is-mine' : 'is-theirs'} ${playing ? 'is-playing' : ''} ${listened ? 'is-listened' : ''}`}>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const audio = e.currentTarget;
          audio.playbackRate = rate;
          const d = audio.duration;
          if (Number.isFinite(d) && d > 0) {
            setDuration(d);
            if (autoPlay && !autoPlayedRef.current) {
              autoPlayedRef.current = true;
              audio.play().catch(() => {});
            }
          } else {
            fixInfiniteDuration(audio);
          }
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (fixingDurationRef.current) return;
          setCurrentTime(a.currentTime);
          const d = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : duration;
          setProgress(d ? a.currentTime / d : 0);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
          setCurrentTime(0);
          maybeBurn();
          if (messageId) notifyVoiceEnded(messageId);
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => {
          setPlaying(true);
          markListened();
        }}
      />

      <div className="voice-main-row">
        {senderAvatar?.userId ? (
          <span className="voice-sender-avatar">
            <UserAvatar
              userId={senderAvatar.userId}
              name={senderAvatar.name}
              hasAvatar={senderAvatar.hasAvatar}
              size="sm"
            />
            <span className={`voice-sender-mic ${listened ? 'is-listened' : ''}`}>
              <Mic size={9} />
            </span>
          </span>
        ) : null}
        <button
          type="button"
          className="voice-play-btn"
          onClick={togglePlay}
          aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        >
          {playing ? (
            <Pause size={14} fill="currentColor" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" className="voice-btn-icon" />
          ) : (
            <Play size={14} fill="currentColor" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" className="voice-btn-icon voice-btn-icon--play" />
          )}
        </button>

        <div
          ref={waveTrackRef}
          className="voice-wave-bars"
          onClick={handleSeek}
          role="slider"
          aria-label="Seek voice message"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
        >
          {bars.map((h, i) => {
            const barProgress = i / (bars.length - 1);
            const isFilled = barProgress <= progress;
            return (
              <span
                key={i}
                className={`voice-wave-bar ${isFilled ? 'filled' : ''}`}
                style={{ height: `${h}%` }}
              />
            );
          })}
        </div>
      </div>

      <div className="voice-meta-row">
        <div className="voice-meta-left">
          <span className="voice-time-label">
            <Mic size={11} className={`voice-mic-icon ${listened ? 'is-listened' : ''}`} />
            <span>{formatDuration(displaySeconds)}</span>
          </span>

          <button
            type="button"
            className={`voice-speed-pill ${rate !== 1 ? 'is-boosted' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              setRate(cyclePlaybackRate(rate));
            }}
            aria-label="Cycle playback speed"
          >
            {rate}x
          </button>
        </div>
      </div>
    </div>
  );
}
