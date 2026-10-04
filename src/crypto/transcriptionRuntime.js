export const WHISPER_MODEL = 'Xenova/whisper-tiny';
export const WHISPER_MODEL_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1';
export const WHISPER_MODEL_LICENSE = 'Apache-2.0';
export const WHISPER_SAMPLE_RATE = 16_000;

let worker;
let nextId = 1;
const pending = new Map();

async function decodeAudioBlob(blob) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  const OfflineAudioContextClass = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!AudioContextClass || !OfflineAudioContextClass) {
    throw new Error('Audio decoding is not supported on this device');
  }

  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const outputLength = Math.ceil(decoded.duration * WHISPER_SAMPLE_RATE);
    if (!Number.isFinite(outputLength) || outputLength < 1) {
      throw new Error('Audio contains no decodable samples');
    }

    const offlineContext = new OfflineAudioContextClass(1, outputLength, WHISPER_SAMPLE_RATE);
    const source = offlineContext.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineContext.destination);
    source.start(0);

    const rendered = await offlineContext.startRendering();
    if (rendered.sampleRate !== WHISPER_SAMPLE_RATE) {
      throw new Error('Audio resampling failed');
    }
    return rendered.getChannelData(0).slice();
  } finally {
    if (context.state !== 'closed') {
      await context.close().catch(() => {});
    }
  }
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./transcriptionWorker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error || 'Transcription worker failed'));
    };
    worker.onerror = (event) => {
      for (const entry of pending.values()) {
        entry.reject(new Error(event?.message || 'Transcription worker failed'));
      }
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

export async function transcribeAudioBlob(blob) {
  if (!(blob instanceof Blob)) {
    throw new TypeError('A Blob is required to transcribe audio');
  }
  const audio = await decodeAudioBlob(blob);

  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ id, type: 'transcribeAudio', audio, samplingRate: WHISPER_SAMPLE_RATE }, [audio.buffer]);
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

export function isTranscriptionSupported() {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined';
}
