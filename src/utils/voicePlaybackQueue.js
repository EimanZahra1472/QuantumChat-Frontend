import { playVoiceAdvanceSound } from './sounds.js';

const players = new Map();
let threadOrder = [];

export function setVoiceThreadOrder(ids = []) {
  threadOrder = (ids || []).map(String).filter(Boolean);
}

export function registerVoicePlayer(messageId, api) {
  const id = String(messageId || '');
  if (!id || !api) return;
  players.set(id, api);
}

export function unregisterVoicePlayer(messageId) {
  players.delete(String(messageId || ''));
}

export function notifyVoiceEnded(messageId) {
  const id = String(messageId || '');
  const idx = threadOrder.indexOf(id);
  if (idx < 0) return false;
  for (let i = idx + 1; i < threadOrder.length; i += 1) {
    const next = players.get(threadOrder[i]);
    if (next?.play) {
      playVoiceAdvanceSound();
      Promise.resolve(next.play()).catch(() => {});
      return true;
    }
  }
  return false;
}
