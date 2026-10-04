import { getToken } from '../crypto/keyStorage.js';

/**
 * QuantumAI API base URL.
 *
 * Prefer same-origin `/quantum-ai` always:
 * - Dev: Vite proxies to the AI host (vite.config.js)
 * - Prod: Vercel rewrites `/quantum-ai` → AI API (vercel.json)
 *
 * Why: the AI host still ships Helmet CORP `same-origin`, which makes the
 * browser discard cross-origin responses even when CORS Allow-Origin is set.
 * Same-origin proxy avoids that entirely.
 *
 * Overrides:
 * - VITE_AI_API_URL=http://localhost:5001/api/v1 → local AI server
 * - VITE_AI_FORCE_DIRECT=true + remote VITE_AI_API_URL → call AI host directly
 *   (only after AI CORP is cross-origin)
 */
function resolveAiApiBase() {
  const fromEnv = String(import.meta.env.VITE_AI_API_URL || '').trim().replace(/\/$/, '');
  const forceDirect = String(import.meta.env.VITE_AI_FORCE_DIRECT || '').toLowerCase() === 'true';
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/i.test(fromEnv);

  if (fromEnv && isLocalhost) return fromEnv;
  if (fromEnv && forceDirect && !isLocalhost) return fromEnv;
  return '/quantum-ai';
}

const AI_API_BASE = resolveAiApiBase();

function headers(json = false) {
  const token = getToken();
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function jsonRequest(path) {
  const response = await fetch(`${AI_API_BASE}${path}`, { headers: headers() });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `QuantumAI request failed (${response.status})`);
  return body.data;
}

export async function getLatestQuantumAIThread() {
  const data = await jsonRequest('/conversations?archived=false&limit=1');
  const conversation = data.conversations?.[0];
  if (!conversation) return { conversationId: null, messages: [] };
  const detail = await jsonRequest(`/conversations/${conversation._id}`);
  return {
    conversationId: conversation._id,
    messages: (detail.messages || []).map((message) => ({
      id: message._id,
      fromQuantumAI: message.role === 'assistant',
      text: message.content,
      createdAt: message.createdAt,
      quantumAI: true,
    })),
  };
}

export function getQuantumAiHealthUrl() {
  if (AI_API_BASE.startsWith('/')) {
    return `${AI_API_BASE}/health`;
  }
  return `${AI_API_BASE}/health`;
}

export async function streamQuantumAI({
  message,
  conversationId,
  context,
  link,
  signal,
  onStart,
  onChunk,
  onDone,
  ephemeral = false,
}) {
  let response;
  try {
    response = await fetch(`${AI_API_BASE}/ai/chat`, {
      method: 'POST',
      headers: headers(true),
      signal,
      body: JSON.stringify({
        message,
        conversationId: conversationId || undefined,
        explicitContext: context?.length ? context : undefined,
        sourceLink: link,
        ephemeral,
        stream: true,
      }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(
      `Cannot reach QuantumAI (${AI_API_BASE}). Is the AI server running? Health: ${getQuantumAiHealthUrl()}`,
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = String(body.error || body.message || '');
    if (response.status === 401) {
      throw new Error(
        'QuantumAI rejected your login token — set the same JWT_SECRET on QuantumChat backend and Quantum-AI-Backend, then log out and log in again',
      );
    }
    if (response.status === 429) {
      throw new Error('QuantumAI rate limit reached — try again in a few minutes');
    }
    if (/llama-3\.3-70b|does not exist|model_not_found/i.test(detail)) {
      throw new Error(
        'QuantumAI model is outdated on the server — set GROQ_CHAT_MODEL=openai/gpt-oss-120b on the AI backend and redeploy',
      );
    }
    if (response.status >= 500) {
      throw new Error(
        detail || 'QuantumAI server error — check GROQ_API_KEY and GROQ_CHAT_MODEL on the AI backend',
      );
    }
    throw new Error(detail || `QuantumAI request failed (${response.status})`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('QuantumAI stream is unavailable');
  const decoder = new TextDecoder();
  let pending = '';
  let finished = false;

  const handleBlock = (block) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1];
    const raw = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!raw) return false;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return false;
    }
    if (event === 'start') onStart?.(data.conversationId);
    if (event === 'chunk') onChunk?.(data.content || '');
    if (event === 'done') {
      onDone?.(data);
      return true; // stream may stay open on proxies — stop waiting
    }
    if (event === 'error') {
      const message = String(data.message || 'QuantumAI stream failed');
      if (/llama-3\.3-70b|does not exist|model_not_found/i.test(message)) {
        throw new Error(
          'QuantumAI model is outdated on the server — set GROQ_CHAT_MODEL=openai/gpt-oss-120b on the AI backend and redeploy',
        );
      }
      throw new Error(message);
    }
    return false;
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const events = pending.split('\n\n');
      pending = events.pop() || '';
      for (const block of events) {
        if (handleBlock(block)) {
          finished = true;
          break;
        }
      }
    }
    // Flush a trailing SSE frame that arrived without a final blank line.
    if (!finished && pending.trim()) {
      handleBlock(pending);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore — stream may already be closed
    }
  }
}
