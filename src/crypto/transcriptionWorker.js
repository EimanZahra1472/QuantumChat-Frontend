const WHISPER_MODEL = 'Xenova/whisper-tiny';
const WHISPER_MODEL_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1';

let pipelineInstance = null;

async function ensurePipeline() {
  if (!pipelineInstance) {
    const { pipeline } = await import('@huggingface/transformers');
    pipelineInstance = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      revision: WHISPER_MODEL_REVISION,
      quantized: true,
      device: 'wasm',
      progress_callback: null,
    });
  }
  return pipelineInstance;
}

self.onmessage = async (event) => {
  const { id, type, blob } = event.data || {};
  try {
    if (type !== 'transcribeAudio') {
      throw new Error(`Unknown transcription task: ${String(type)}`);
    }
    if (!(blob instanceof Blob)) {
      throw new Error('Missing audio blob for transcription');
    }

    const transcriber = await ensurePipeline();
    const result = await transcriber(blob, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });

    const text = typeof result === 'string' ? result : result?.text || '';
    self.postMessage({ id, ok: true, result: { text } });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message || String(err),
    });
  }
};
