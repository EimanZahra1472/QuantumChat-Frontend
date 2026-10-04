export function isAudioAttachmentLike(attachment = null) {
  if (!attachment) return false;
  const mime = String(attachment.mimetype || '').toLowerCase();
  const name = String(attachment.filename || '').toLowerCase();
  return (
    mime.startsWith('audio/') ||
    /^voice-note/i.test(name) ||
    /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|webm)$/i.test(name)
  );
}

export function getTranscriptTargetPublicKey(message, isMine = false) {
  if (!message) return null;
  const senderEnvelope = message.forSender;
  const recipientEnvelope = message.forRecipient;

  if (isMine && senderEnvelope?.targetPublicKey) return senderEnvelope.targetPublicKey;
  if (!isMine && recipientEnvelope?.targetPublicKey) return recipientEnvelope.targetPublicKey;
  if (senderEnvelope?.targetPublicKey) return senderEnvelope.targetPublicKey;
  if (recipientEnvelope?.targetPublicKey) return recipientEnvelope.targetPublicKey;
  if (Array.isArray(message.envelopes)) {
    const mineEntry = message.envelopes.find((entry) => String(entry.user) === String(message.from));
    if (mineEntry?.targetPublicKey) return mineEntry.targetPublicKey;
  }
  return null;
}

export function getParticipantTranscript(message, userId, isMine = false) {
  const transcription = message?.transcription;
  if (!transcription) return null;
  const participantTranscript = transcription.entries?.find(
    (entry) => String(entry.user) === String(userId),
  );
  if (participantTranscript) return participantTranscript;
  return isMine ? transcription : null;
}

export function getStoredTranscript(message, userId, isMine = false) {
  const transcription = getParticipantTranscript(message, userId, isMine);
  if (!transcription) return null;
  if (!transcription.encryptedText || !transcription.nonce || !transcription.targetPublicKey) {
    return null;
  }
  return transcription;
}

export function hasCompletedTranscript(message, userId, isMine = false) {
  const transcription = getStoredTranscript(message, userId, isMine);
  if (!transcription) return false;
  return transcription.status === 'completed' || Boolean(transcription.decryptedText || transcription.encryptedText);
}

export function getFriendlyTranscriptionError(error, fallback = 'Transcription failed') {
  const message = String(error?.message || error || '');
  const lower = message.toLowerCase();
  if (lower.includes('unsupported') || lower.includes('not supported')) {
    return 'Transcription is not supported on this device.';
  }
  if (lower.includes('authorization') || lower.includes('403') || lower.includes('claim') || lower.includes('token')) {
    return 'You can no longer transcribe this voice message from this device.';
  }
  if (lower.includes('no usable speech') || lower.includes('no speech') || lower.includes('silence')) {
    return 'No speech was detected in this audio.';
  }
  if (lower.includes('unable to decode audio') || lower.includes('audio contains no decodable samples')) {
    return 'This audio format could not be decoded on this device.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('failed to load model') ||
    lower.includes('could not load model')
  ) {
    return 'The transcription service could not load this audio right now. Please try again.';
  }
  if (lower.includes('decrypt') || lower.includes('missing') || lower.includes('expired')) {
    return 'This voice message is no longer available for transcription.';
  }
  return fallback;
}

export function canTranscribeVoiceMessage(message, attachment = null, viewOnce = false) {
  if (viewOnce) return false;
  if (!message && !attachment) return false;
  const attachmentCandidate = attachment || message?.attachment;
  const isAudio = isAudioAttachmentLike(attachmentCandidate) || message?.viewOnceMediaKind === 'audio';
  return Boolean(isAudio && getTranscriptTargetPublicKey(message, Boolean(message && String(message.from) === String(message?.currentUserId || ''))));
}
