import assert from 'node:assert/strict';
import test from 'node:test';

import { transcribeAudioBlob, WHISPER_SAMPLE_RATE } from '../src/crypto/transcriptionRuntime.js';

test('decodes a Blob and transfers 16 kHz Float32 PCM to the worker', async () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalOfflineAudioContext = globalThis.OfflineAudioContext;
  const originalWorker = globalThis.Worker;
  let offlineContextArgs;
  let workerMessage;

  class MockAudioContext {
    state = 'running';

    async decodeAudioData(data) {
      assert.equal(data.byteLength, 4);
      return { duration: 1 };
    }

    async close() {
      this.state = 'closed';
    }
  }

  class MockOfflineAudioContext {
    constructor(...args) {
      offlineContextArgs = args;
      this.destination = {};
    }

    createBufferSource() {
      return {
        connect() {},
        start() {},
        set buffer(value) {
          assert.equal(value.duration, 1);
        },
      };
    }

    async startRendering() {
      return {
        sampleRate: WHISPER_SAMPLE_RATE,
        getChannelData: () => new Float32Array([0.125, -0.25]),
      };
    }
  }

  class MockWorker {
    postMessage(data, transfer) {
      workerMessage = { data, transfer };
      queueMicrotask(() => this.onmessage({
        data: { id: data.id, ok: true, result: { text: 'test result' } },
      }));
    }
  }

  globalThis.AudioContext = MockAudioContext;
  globalThis.OfflineAudioContext = MockOfflineAudioContext;
  globalThis.Worker = MockWorker;

  try {
    const result = await transcribeAudioBlob(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' }));

    assert.deepEqual(offlineContextArgs, [1, WHISPER_SAMPLE_RATE, WHISPER_SAMPLE_RATE]);
    assert.equal(result.text, 'test result');
    assert.equal(workerMessage.data.type, 'transcribeAudio');
    assert.equal(workerMessage.data.samplingRate, WHISPER_SAMPLE_RATE);
    assert.equal(workerMessage.data.audio instanceof Float32Array, true);
    assert.deepEqual(Array.from(workerMessage.data.audio), [0.125, -0.25]);
    assert.deepEqual(workerMessage.transfer, [workerMessage.data.audio.buffer]);
    assert.equal('blob' in workerMessage.data, false);
  } finally {
    globalThis.AudioContext = originalAudioContext;
    globalThis.OfflineAudioContext = originalOfflineAudioContext;
    globalThis.Worker = originalWorker;
  }
});