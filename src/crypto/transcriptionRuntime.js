export const WHISPER_MODEL = 'Xenova/whisper-tiny';
export const WHISPER_MODEL_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1';
export const WHISPER_MODEL_LICENSE = 'Apache-2.0';

let worker;
let nextId = 1;
const pending = new Map();

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
    };
  }
  return worker;
}

export function transcribeAudioBlob(blob) {
  if (!(blob instanceof Blob)) {
    return Promise.reject(new Error('A Blob is required to transcribe audio'));
  }

  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type: 'transcribeAudio', blob });
  });
}

export function isTranscriptionSupported() {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined';
}
