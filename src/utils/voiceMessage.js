import { parseGroupPayload } from './groupPayload.js';

const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac)$/i;
export const VOICE_WAVEFORM_BARS = 40;

export function isAudioMeta(mimetype, filename) {
  const mime = String(mimetype || '').toLowerCase();
  const name = String(filename || '').toLowerCase();
  return (
    mime.startsWith('audio/') ||
    /^voice-note/i.test(name) ||
    AUDIO_EXT.test(name) ||
    (/\.webm$/i.test(name) && (/^voice-note/i.test(name) || mime.startsWith('audio/')))
  );
}

export function fileMetaFromStructured(structured) {
  if (!structured || typeof structured !== 'object') return { mimetype: '', filename: '' };
  const nested = structured.payload && typeof structured.payload === 'object' ? structured.payload : null;
  return {
    mimetype: structured.mimetype || nested?.mimetype || '',
    filename: structured.filename || nested?.filename || '',
    waveform: structured.waveform || nested?.waveform,
    durationSeconds: structured.durationSeconds ?? nested?.durationSeconds,
  };
}

export function normalizeWaveform(peaks, count = VOICE_WAVEFORM_BARS) {
  if (!Array.isArray(peaks) || !peaks.length) return null;
  const cleaned = peaks
    .map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0))))
    .filter((n) => Number.isFinite(n))
    .slice(0, 64);
  if (!cleaned.length) return null;
  if (cleaned.length === count) return cleaned;
  if (cleaned.length > count) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const idx = Math.floor((i * cleaned.length) / count);
      out.push(cleaned[idx]);
    }
    return out;
  }
  return cleaned;
}

export function isVoiceStructured(structured) {
  if (!structured) return false;
  if (structured.type === 'voice') return true;
  if (structured.type === 'file') {
    const meta = fileMetaFromStructured(structured);
    return isAudioMeta(meta.mimetype, meta.filename);
  }
  return false;
}

export function isConversationVoiceMessage(message) {
  if (!message) return false;
  if (message.viewOnceMediaKind === 'audio') return true;
  if (message.attachment && isAudioMeta(message.attachment.mimetype, message.attachment.filename)) {
    return true;
  }
  if (Array.isArray(message.waveform) || (typeof message.durationSeconds === 'number' && message.durationSeconds > 0)) {
    return true;
  }
  if (typeof message.text === 'string' && isAudioMeta('', message.text)) {
    return true;
  }
  return isVoiceStructured(parseGroupPayload(message.text));
}

export function voiceMetaFromMessage(message) {
  const structured = parseGroupPayload(message?.text);
  const meta = fileMetaFromStructured(structured);
  return {
    waveform: normalizeWaveform(meta.waveform),
    durationSeconds: Number.isFinite(Number(meta.durationSeconds)) ? Number(meta.durationSeconds) : null,
  };
}
