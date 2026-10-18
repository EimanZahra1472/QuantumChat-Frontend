/** Structured group payloads sealed inside per-member envelopes. */

export function encodeGroupPayload(payload) {
  return JSON.stringify({ __qc: 1, ...payload });
}

export function parseGroupPayload(text) {
  if (!text || typeof text !== 'string') return { type: 'text', body: text || '' };
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return { type: 'text', body: text };
  try {
    const obj = JSON.parse(trimmed);
    if (obj && obj.__qc === 1 && obj.type) return obj;
  } catch {
    /* plain text */
  }
  return { type: 'text', body: text };
}

/** True when decrypted text is a QuantumChat structured payload (file/voice/poll/…). */
export function isQcStructuredPayload(text) {
  const parsed = parseGroupPayload(text);
  return Boolean(parsed?.type && parsed.type !== 'text');
}

/**
 * When an optimistic bubble is confirmed over the socket, keep a locally
 * decrypted structured payload and never let a placeholder filename clobber it.
 */
export function preferConfirmedThreadText(pendingText, confirmedText, { mediaPending = false } = {}) {
  if (isQcStructuredPayload(confirmedText)) return confirmedText;
  if (isQcStructuredPayload(pendingText) && !isQcStructuredPayload(confirmedText)) {
    return pendingText;
  }
  if (mediaPending) return confirmedText ?? pendingText;
  return pendingText ?? confirmedText;
}

export function encodePoll({ question, options }) {
  return encodeGroupPayload({
    type: 'poll',
    question: String(question || '').trim(),
    options: (options || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 8),
  });
}

export function encodeEvent({ title, when, where, notes }) {
  return encodeGroupPayload({
    type: 'event',
    title: String(title || '').trim(),
    when: when || '',
    where: String(where || '').trim(),
    notes: String(notes || '').trim(),
  });
}

export function encodeAnnouncement(body) {
  return encodeGroupPayload({ type: 'announcement', body: String(body || '') });
}

export function encodeGroupFile({
  attachmentId,
  key,
  nonce,
  filename,
  mimetype,
  size,
  waveform,
  durationSeconds,
}) {
  const payload = {
    type: 'file',
    attachmentId,
    key,
    nonce,
    filename,
    mimetype,
    size,
  };
  if (Array.isArray(waveform) && waveform.length) payload.waveform = waveform;
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    payload.durationSeconds = durationSeconds;
  }
  return encodeGroupPayload(payload);
}

export function encodeVoiceMeta({ waveform, durationSeconds, filename, mimetype }) {
  const payload = { type: 'voice', filename, mimetype };
  if (Array.isArray(waveform) && waveform.length) payload.waveform = waveform;
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    payload.durationSeconds = durationSeconds;
  }
  return encodeGroupPayload(payload);
}

export function extractMentions(text, members = []) {
  const byName = new Map(
    members
      .filter((m) => m?.username)
      .map((m) => [String(m.username).toLowerCase(), String(m.id || m._id)])
  );
  const ids = new Set();
  const re = /@([a-zA-Z0-9_.-]{2,32})/g;
  let match;
  while ((match = re.exec(text || ''))) {
    const id = byName.get(match[1].toLowerCase());
    if (id) ids.add(id);
  }
  return [...ids];
}

export function renderMentionParts(text) {
  const parts = [];
  const re = /(@[a-zA-Z0-9_.-]{2,32})/g;
  let last = 0;
  let match;
  while ((match = re.exec(text || ''))) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });
    parts.push({ type: 'mention', value: match[1] });
    last = match.index + match[1].length;
  }
  if (last < (text || '').length) parts.push({ type: 'text', value: text.slice(last) });
  return parts.length ? parts : [{ type: 'text', value: text || '' }];
}

export function isGroupAdmin(group, userId) {
  if (!group || !userId) return false;
  const id = String(userId);
  const admins = (group.admins || []).map(String);
  if (admins.length) return admins.includes(id);
  return String(group.createdBy) === id;
}
