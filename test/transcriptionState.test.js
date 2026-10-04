import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getParticipantTranscript,
  getTranscriptTargetPublicKey,
  getFriendlyTranscriptionError,
  getStoredTranscript,
  hasCompletedTranscript,
  isAudioAttachmentLike,
} from '../src/utils/transcriptionState.js';

test('recognizes voice attachments by mime and filename', () => {
  assert.equal(isAudioAttachmentLike({ mimetype: 'audio/mpeg' }), true);
  assert.equal(isAudioAttachmentLike({ filename: 'voice-note.webm' }), true);
  assert.equal(isAudioAttachmentLike({ filename: 'photo.png' }), false);
});

test('rejects incomplete transcript payloads', () => {
  const incomplete = { transcription: { status: 'queued' } };
  const valid = {
    transcription: {
      status: 'completed',
      encryptedText: 'cipher',
      nonce: 'nonce',
      targetPublicKey: 'pk',
    },
  };

  assert.equal(getStoredTranscript(incomplete, 'sender', true), null);
  assert.deepEqual(getStoredTranscript(valid, 'sender', true), valid.transcription);
  assert.equal(getStoredTranscript(valid, 'recipient'), null);
});

test('marks a completed transcript as available', () => {
  const message = {
    transcription: {
      status: 'completed',
      encryptedText: 'cipher',
      nonce: 'nonce',
      targetPublicKey: 'pk',
    },
  };

  assert.equal(hasCompletedTranscript(message, 'sender', true), true);
});

test('selects only the current participant transcript and matching DM envelope key', () => {
  const message = {
    from: 'alice',
    to: 'bob',
    forSender: { targetPublicKey: 'sender-key' },
    forRecipient: { targetPublicKey: 'recipient-key' },
    transcription: {
      entries: [
        { user: 'alice', encryptedText: 'alice-ciphertext' },
        { user: 'bob', encryptedText: 'bob-ciphertext' },
      ],
    },
  };

  assert.equal(getParticipantTranscript(message, 'bob').encryptedText, 'bob-ciphertext');
  assert.equal(getTranscriptTargetPublicKey(message, true), 'sender-key');
  assert.equal(getTranscriptTargetPublicKey(message, false), 'recipient-key');
});

test('maps common transcription failures to user-friendly messages', () => {
  assert.match(getFriendlyTranscriptionError(new Error('No usable speech detected')), /No speech/i);
  assert.match(getFriendlyTranscriptionError(new Error('Authorization required')), /transcribe this voice message/i);
  assert.match(getFriendlyTranscriptionError(new Error('Unsupported on this browser')), /not supported/i);
});

test('does not misclassify the Whisper Float32 input error as a network failure', () => {
  const error = new Error(
    'WhisperFeatureExtractor expects input to be a Float32Array or a Float64Array, but got Blob instead. ' +
    'Remember to use load_audio(url, sampling_rate) to obtain raw audio data.',
  );

  assert.equal(getFriendlyTranscriptionError(error), 'Transcription failed');
});
