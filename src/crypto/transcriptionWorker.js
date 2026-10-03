const WHISPER_MODEL = 'Xenova/whisper-tiny';
const WHISPER_MODEL_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1';
const WHISPER_SAMPLE_RATE = 16_000;

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
  const { id, type, audio, samplingRate } = event.data || {};
  try {
    if (type !== 'transcribeAudio') {
      throw new Error(`Unknown transcription task: ${String(type)}`);
    }
    if (!(audio instanceof Float32Array)) {
      throw new TypeError('Expected decoded Float32 PCM audio');
    }
    if (samplingRate !== WHISPER_SAMPLE_RATE) {
      throw new Error(`Whisper audio must be sampled at ${WHISPER_SAMPLE_RATE} Hz`);
    }

    const transcriber = await ensurePipeline();
    const result = await transcriber(audio, {
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
