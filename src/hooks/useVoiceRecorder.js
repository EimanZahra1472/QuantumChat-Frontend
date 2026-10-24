import { useCallback, useEffect, useRef, useState } from 'react';
import { pickRecorderMimeType } from '../crypto/voiceCache.js';
import { normalizeWaveform, VOICE_WAVEFORM_BARS } from '../utils/voiceMessage.js';

function extensionForType(type) {
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

/**
 * Custom hook encapsulating voice recording lifecycle, audio levels analysis,
 * preview playback, and sending orchestration.
 */
export default function useVoiceRecorder({
  activeChatKey,
  onSendVoice,
  disabled = false,
  onError,
  maxSeconds = 60,
} = {}) {
  const [phase, setPhase] = useState('idle');
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState(() => Array.from({ length: 24 }, () => 12));
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewMeta, setPreviewMeta] = useState(null);
  const [sending, setSending] = useState(false);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const peaksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const rafRef = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const mimeRef = useRef('');
  const phaseRef = useRef('idle');

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopAnalyser = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {
      // ignore
    }
    audioCtxRef.current = null;
  }, []);

  const clearHardware = useCallback(
    ({ keepPreview = false } = {}) => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      stopAnalyser();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      recorderRef.current = null;
      chunksRef.current = [];
      if (!keepPreview) {
        setSeconds(0);
        setPaused(false);
      }
    },
    [stopAnalyser],
  );

  const startAnalyser = useCallback((stream) => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i += 1) {
          if (data[i] > peak) peak = data[i];
        }
        const normalized = Math.max(8, Math.round((peak / 255) * 100));
        peaksRef.current.push(normalized);
        setLevels((prev) => {
          const next = prev.slice(1);
          next.push(normalized);
          return next;
        });
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // visualizer is optional
    }
  }, []);

  const finishRecording = useCallback(
    (recorder) =>
      new Promise((resolve) => {
        const chunks = chunksRef.current.slice();
        const type = (recorder?.mimeType || mimeRef.current || 'audio/webm').split(';')[0];
        const durationSeconds = Math.max(0.4, (Date.now() - startedAtRef.current) / 1000);
        const waveform = normalizeWaveform(peaksRef.current, VOICE_WAVEFORM_BARS);
        clearHardware({ keepPreview: true });

        if (!chunks.length) {
          setPhase('idle');
          resolve({ error: 'No audio captured — please try speaking again' });
          return;
        }

        const blob = new Blob(chunks, { type: type || 'audio/webm' });
        if (blob.size < 256) {
          setPhase('idle');
          resolve({ error: 'Voice note too short — hold or speak a bit longer' });
          return;
        }

        const ext = extensionForType(type || '');
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
          type: type || 'audio/webm',
        });

        blob
          .arrayBuffer()
          .then((buf) => {
            const plainBytes = new Uint8Array(buf);
            const url = URL.createObjectURL(blob);
            resolve({
              data: {
                file,
                plainBytes,
                waveform,
                durationSeconds,
                url,
              },
            });
          })
          .catch(() => {
            setPhase('idle');
            resolve({ error: 'Failed to process voice note audio' });
          });
      }),
    [clearHardware],
  );

  const startRecording = useCallback(async () => {
    if (disabled || phase !== 'idle') return { error: null };
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      const err = 'Voice notes are not supported in this browser';
      onError?.(err);
      return { error: err };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      mimeRef.current = mimeType;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      peaksRef.current = [];
      startedAtRef.current = Date.now();
      setLevels(Array.from({ length: 24 }, () => 12));
      setSeconds(0);
      setPaused(false);

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        clearHardware();
        setPhase('idle');
      };

      recorder.start(200);
      startAnalyser(stream);
      setPhase('recording');

      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) {
          const rec = recorderRef.current;
          if (rec && rec.state !== 'inactive') rec.stop();
        }
      }, 200);

      return { error: null };
    } catch {
      clearHardware();
      setPhase('idle');
      const err = 'Microphone permission is required to record voice notes';
      onError?.(err);
      return { error: err };
    }
  }, [clearHardware, disabled, maxSeconds, onError, phase, startAnalyser]);

  const cancelRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onstop = () => {
        clearHardware();
        setPhase('idle');
      };
      try {
        recorder.stop();
      } catch {
        clearHardware();
        setPhase('idle');
      }
      return;
    }
    clearHardware();
    setPhase('idle');
  }, [clearHardware]);

  const stopToPreview = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      clearHardware();
      setPhase('idle');
      return { error: 'No active recording' };
    }
    return new Promise((resolve) => {
      recorder.onstop = async () => {
        const res = await finishRecording(recorder);
        if (res.error) {
          resolve(res);
          return;
        }
        setPreviewUrl(res.data.url);
        setPreviewMeta(res.data);
        setSeconds(Math.round(res.data.durationSeconds));
        setPhase('preview');
        resolve({ data: res.data });
      };
      try {
        if (recorder.state === 'recording') recorder.requestData();
        recorder.stop();
      } catch {
        clearHardware();
        setPhase('idle');
        resolve({ error: 'Voice recording failed' });
      }
    });
  }, [clearHardware, finishRecording]);

  const stopAndGetPayload = useCallback(async () => {
    if (phaseRef.current === 'preview' && previewMeta) {
      return { data: previewMeta };
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      clearHardware();
      setPhase('idle');
      return { error: 'No active recording' };
    }
    return new Promise((resolve) => {
      recorder.onstop = async () => {
        const res = await finishRecording(recorder);
        if (res.data) {
          setPhase('idle');
          setPreviewUrl(null);
          setPreviewMeta(null);
          setSeconds(0);
        }
        resolve(res);
      };
      try {
        if (recorder.state === 'recording') recorder.requestData();
        recorder.stop();
      } catch {
        clearHardware();
        setPhase('idle');
        resolve({ error: 'Voice recording failed' });
      }
    });
  }, [clearHardware, finishRecording, previewMeta]);

  const discardPreview = useCallback(() => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewMeta(null);
    setPhase('idle');
    setSeconds(0);
    setPaused(false);
  }, []);

  const reset = useCallback(() => {
    clearHardware();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewMeta(null);
    setPhase('idle');
    setSeconds(0);
    setPaused(false);
  }, [clearHardware, previewUrl]);

  const togglePause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      if (recorder.state === 'recording') {
        recorder.pause();
        setPaused(true);
      } else if (recorder.state === 'paused') {
        recorder.resume();
        setPaused(false);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleVoiceSend = useCallback(async () => {
    if (sending) return;
    setSending(true);
    try {
      let payload = previewMeta;
      if (!payload && phaseRef.current !== 'idle' && phaseRef.current !== 'preview') {
        const res = await stopAndGetPayload();
        if (res?.error) {
          onError?.(res.error);
          return;
        }
        payload = res?.data;
      }
      if (!payload?.file) return;

      if (onSendVoice) {
        await onSendVoice(payload.file, {
          plainBytes: payload.plainBytes,
          waveform: payload.waveform,
          durationSeconds: payload.durationSeconds,
        });
      }
      reset();
    } catch (err) {
      onError?.(
        err?.response?.data?.error || err?.message || 'Failed to send voice note',
      );
    } finally {
      setSending(false);
    }
  }, [sending, previewMeta, stopAndGetPayload, onSendVoice, reset, onError]);

  const bindMic = useCallback(
    ({ onError: onBindError } = {}) => ({
      onClick: async (e) => {
        e?.preventDefault?.();
        if (disabled) return;
        if (phase === 'idle') {
          const res = await startRecording();
          if (res?.error) (onBindError || onError)?.(res.error);
        }
      },
    }),
    [disabled, onError, phase, startRecording],
  );

  // Cancel recording and discard preview when active chat switches
  useEffect(() => {
    cancelRecording();
    discardPreview();
  }, [activeChatKey, cancelRecording, discardPreview]);

  // Cleanup all hardware resources and Object URLs on unmount
  useEffect(() => {
    return () => {
      clearHardware();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // Primary properties
    isRecording: phase === 'recording',
    duration: seconds,
    audioLevel: levels[levels.length - 1] ?? 12,
    recordedResult: previewMeta,
    sending,

    // Phase & audio state
    phase,
    paused,
    seconds,
    levels,
    previewUrl,
    previewMeta,
    maxSeconds,

    // Actions
    bindMic,
    startRecording,
    stopRecording: stopToPreview,
    cancelRecording,
    stopToPreview,
    stopAndGetPayload,
    discardPreview,
    togglePause,
    reset,
    handleVoiceSend,
  };
}
