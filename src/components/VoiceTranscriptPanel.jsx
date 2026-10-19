import { useMemo, useState } from 'react';
import client from '../api/client.js';
import { transcribeAudioBlob } from '../crypto/transcriptionRuntime.js';
import { sealMessage, unsealMessage } from '../crypto/keys.js';
import {
  getFriendlyTranscriptionError,
  getParticipantTranscript,
  getStoredTranscript,
  getTranscriptTargetPublicKey,
} from '../utils/transcriptionState.js';

export default function VoiceTranscriptPanel({
  message,
  currentUserId,
  isMine,
  resolveSecretKey,
  getAudioBlob,
  onTranscriptStateChange,
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');
  const [copied, setCopied] = useState(false);

  const transcriptState = getParticipantTranscript(message, currentUserId, isMine);
  const storedTranscript = getStoredTranscript(message, currentUserId, isMine);
  const transcriptEnvelope =
    transcriptState &&
    transcriptState.encryptedText &&
    transcriptState.nonce &&
    transcriptState.ephemeralPublicKey &&
    transcriptState.targetPublicKey
      ? {
          ciphertext: transcriptState.encryptedText,
          nonce: transcriptState.nonce,
          ephemeralPublicKey: transcriptState.ephemeralPublicKey,
          targetPublicKey: transcriptState.targetPublicKey,
        }
      : null;
  const transcriptText = useMemo(() => {
    if (!transcriptEnvelope) return '';
    const secretKey = resolveSecretKey?.(transcriptEnvelope.targetPublicKey);
    if (!secretKey) return '';
    return unsealMessage(transcriptEnvelope, secretKey) || '';
  }, [resolveSecretKey, transcriptEnvelope]);
  const transcriptStatus = transcriptState?.status || (transcriptText ? 'completed' : 'unsupported');
  const hasTranscript = Boolean(storedTranscript && transcriptText);

  async function startTranscription() {
    const messageId = message?.id || message?._id;
    if (!messageId || transcribing) return;
    if (transcriptStatus === 'completed' && hasTranscript) {
      setShowTranscript(true);
      return;
    }
    if (transcriptStatus === 'running' || transcriptStatus === 'queued') return;

    setTranscribing(true);
    setTranscriptError('');
    let claimToken;
    try {
      if (storedTranscript && transcriptText) {
        setShowTranscript(true);
        return;
      }

      const claimResult = await client.post(`/messages/${messageId}/transcription`, {
        action: 'claim',
      });
      const claimedParticipant = claimResult?.data?.data?.transcription?.participant;
      if (claimedParticipant?.encryptedText) {
        onTranscriptStateChange?.(messageId, claimedParticipant);
        setShowTranscript(true);
        return;
      }
      claimToken = claimedParticipant?.claimToken;
      if (!claimToken) throw new Error('authorization');

      const blob = await getAudioBlob?.();
      if (!(blob instanceof Blob)) throw new Error('missing');
      const result = await transcribeAudioBlob(blob);
      const text = String(result?.text || '').trim();
      if (!text) throw new Error('No usable speech');

      const targetPublicKey = getTranscriptTargetPublicKey(message, isMine, currentUserId);
      if (!targetPublicKey) throw new Error('missing');

      const sealed = sealMessage(text, targetPublicKey);
      const commitPayload = {
        action: 'commit',
        claimToken,
        status: 'completed',
        encryptedText: sealed.ciphertext,
        nonce: sealed.nonce,
        ephemeralPublicKey: sealed.ephemeralPublicKey,
        targetPublicKey: sealed.targetPublicKey,
        language: 'auto',
      };

      const response = await client.post(`/messages/${messageId}/transcription`, commitPayload);
      const nextParticipant = response?.data?.data?.transcription?.participant || {
        user: currentUserId,
        ...commitPayload,
        status: 'completed',
      };
      onTranscriptStateChange?.(messageId, nextParticipant);
      setShowTranscript(true);
      setTranscriptError('');
    } catch (err) {
      const safe = getFriendlyTranscriptionError(err, 'Transcription failed. Please try again.');
      setTranscriptError(safe);
      if (claimToken) {
        try {
          await client.post(`/messages/${messageId}/transcription`, {
            action: 'release',
            claimToken,
            error: safe,
          });
        } catch {
          // lease expires if release cannot complete
        }
      }
      if (messageId) {
        onTranscriptStateChange?.(messageId, {
          user: currentUserId,
          status: 'failed',
          error: safe,
        });
      }
    } finally {
      setTranscribing(false);
    }
  }

  async function copyTranscript() {
    if (!transcriptText) return;
    try {
      await navigator.clipboard.writeText(transcriptText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (!message) return null;

  return (
    <div className="transcript-action-panel" aria-live="polite">
      {transcriptStatus === 'completed' && hasTranscript ? (
        <>
          <div className="transcript-inline-header">
            <span className="transcript-badge">Transcribed</span>
            <div className="transcript-inline-actions">
              <button
                type="button"
                className="transcript-inline-btn"
                onClick={() => setShowTranscript((v) => !v)}
                aria-expanded={showTranscript}
              >
                {showTranscript ? 'Hide' : 'Show'}
              </button>
              <button type="button" className="transcript-inline-btn" onClick={copyTranscript}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          {showTranscript && (
            <div className="transcript-inline-text" tabIndex={0} role="note" aria-label="Voice message transcript">
              {transcriptText || 'Transcript decrypted locally'}
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          className="transcript-inline-primary"
          onClick={startTranscription}
          disabled={transcribing || transcriptStatus === 'running' || transcriptStatus === 'queued'}
          aria-busy={transcribing}
        >
          {transcribing ? 'Transcribing…' : transcriptStatus === 'failed' ? 'Retry' : 'Transcribe'}
        </button>
      )}
      {transcriptStatus === 'running' || transcriptStatus === 'queued' ? (
        <div className="transcript-inline-status" aria-live="polite">
          Transcribing…
        </div>
      ) : null}
      {transcriptError ? (
        <div className="transcript-inline-error" role="alert">
          {transcriptError}
        </div>
      ) : null}
    </div>
  );
}
