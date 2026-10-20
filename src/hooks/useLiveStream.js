import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiUrl } from '../api/baseUrl.js';
import {
  endLive,
  getLive,
  heartbeatLive,
  inviteToLive,
  joinLive,
  leaveLive,
  removeLiveViewer,
  setLiveRecordingDecision,
  startLive,
} from '../api/live.js';
import { getSocket } from '../api/socket.js';
import { getToken } from '../crypto/keyStorage.js';
import { getCallMedia } from '../utils/callMedia.js';
import {
  ICE_SERVERS,
  emitSealedEnvelope,
  newSignalId,
  registerSignalHandlers,
  unsealCallEnvelope,
} from '../utils/callSignalTransport.js';

export const LIVE_REACTIONS = ['❤️', '😂', '😮', '👏', '🔥', '😢'];
export const LIVE_COMMENT_MAX = 300;

const HEARTBEAT_MS = 10_000;
const VIEWER_STATUS_POLL_MS = 15_000;
const CONNECT_TIMEOUT_MS = 30_000;
const PEER_DROP_GRACE_MS = 10_000;
const MAX_COMMENTS = 200;
const BACKLOG_COMMENTS = 30;
const MAX_CHANNEL_MESSAGE = 2_000;
const REACTION_TTL_MS = 2_600;
// Host-side flood control per viewer: the host is the only relay for
// comments, so it is also the only place that can throttle them.
const RATE_WINDOW_MS = 5_000;
const COMMENT_BURST = 5;
const REACTION_BURST = 12;

const RECORDER_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return RECORDER_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

function nameOf(u) {
  return u?.displayName || u?.username || 'Someone';
}

function withinRate(log, burst) {
  const now = Date.now();
  while (log.length && now - log[0] > RATE_WINDOW_MS) log.shift();
  if (log.length >= burst) return false;
  log.push(now);
  return true;
}

function sendJson(channel, message) {
  if (channel?.readyState !== 'open') return;
  try {
    channel.send(JSON.stringify(message));
  } catch {
    /* channel closing */
  }
}

function parseChannelMessage(event) {
  if (typeof event.data !== 'string' || event.data.length > MAX_CHANNEL_MESSAGE) return null;
  try {
    const msg = JSON.parse(event.data);
    return msg && typeof msg === 'object' ? msg : null;
  } catch {
    return null;
  }
}

/** Best-effort REST call that survives the page unloading. */
function keepaliveRequest(path) {
  const token = getToken();
  if (!token) return;
  try {
    fetch(`${getApiUrl()}${path}`, {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Live streaming state machine — star topology. The host holds one
 * RTCPeerConnection per viewer and sends its camera/mic down each one; a
 * viewer only ever connects to the host. Each connection also carries a
 * data channel, and the host acts as the hub for comments, reactions and
 * the live viewer count: viewers send to the host, the host validates,
 * rate-limits and fans out to everyone. None of that touches the server.
 *
 * The server's part is admission: a viewer must POST /live/:id/join (which
 * checks the audience/privacy rules) before the signaling relay will carry
 * its `live:offer` to the host. Signaling is the same X5 sealed-box
 * transport as calls and meetings (callSignalTransport.js), keyed by the
 * stream id in the `callId` field.
 *
 * Recording happens on the host's device (MediaRecorder on the local
 * stream). After the stream ends the host decides to save (download) or
 * discard it; the recording is never uploaded.
 */
export default function useLiveStream({ user } = {}) {
  const userId = user?.id ? String(user.id) : '';
  const [live, setLive] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [viewers, setViewers] = useState([]);
  const [comments, setComments] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [connection, setConnection] = useState('idle');
  const [recording, setRecording] = useState(null);

  const liveRef = useRef(null);
  const userRef = useRef(user);
  userRef.current = user;
  const localStreamRef = useRef(null);
  // Host: viewerId -> { pc, channel, name, keys, commentLog, reactionLog, dropTimer }
  const peersRef = useRef(new Map());
  // Viewer: { pc, channel, hostId, hostKeys }
  const viewerLinkRef = useRef(null);
  const pendingIceRef = useRef(new Map());
  const commentsRef = useRef([]);
  const recorderRef = useRef(null);
  const recorderChunksRef = useRef([]);
  const heartbeatTimerRef = useRef(null);
  const statusTimerRef = useRef(null);
  const connectTimerRef = useRef(null);
  const peakRef = useRef(0);
  const recordingRef = useRef(null);
  recordingRef.current = recording;

  const commitLive = useCallback((next) => {
    liveRef.current = next;
    setLive(next);
  }, []);

  const addComment = useCallback((comment) => {
    const next = [...commentsRef.current, comment].slice(-MAX_COMMENTS);
    commentsRef.current = next;
    setComments(next);
  }, []);

  const showReaction = useCallback((emoji) => {
    const id = newSignalId('reaction');
    setReactions((prev) => [...prev.slice(-30), { id, emoji, x: Math.random() }]);
    window.setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, REACTION_TTL_MS);
  }, []);

  const sendSignal = useCallback((eventName, to, keys, payload) => {
    const streamId = liveRef.current?.streamId;
    if (!streamId || !keys?.length) return Promise.resolve();
    return emitSealedEnvelope(eventName, { to, callId: streamId, payload, peerKeys: keys }).catch(() => {});
  }, []);

  // ---- host helpers -------------------------------------------------------

  const openPeerIds = useCallback(
    () => [...peersRef.current.entries()].filter(([, p]) => p.channel?.readyState === 'open').map(([id]) => id),
    []
  );

  const broadcast = useCallback((message, { except } = {}) => {
    for (const [peerId, peer] of peersRef.current.entries()) {
      if (peerId === except) continue;
      sendJson(peer.channel, message);
    }
  }, []);

  const publishMeta = useCallback(() => {
    const l = liveRef.current;
    if (!l || l.role !== 'host') return;
    const count = openPeerIds().length;
    peakRef.current = Math.max(peakRef.current, count);
    setViewerCount(count);
    setViewers(
      openPeerIds().map((id) => ({ id, name: peersRef.current.get(id)?.name || 'Viewer' }))
    );
    broadcast({ t: 'meta', viewerCount: count, allowComments: l.allowComments !== false, title: l.title || '' });
  }, [broadcast, openPeerIds]);

  const dropPeer = useCallback(
    (peerId) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      if (peer.dropTimer) window.clearTimeout(peer.dropTimer);
      try {
        peer.channel?.close();
        peer.pc.close();
      } catch {
        /* ignore */
      }
      peersRef.current.delete(peerId);
      pendingIceRef.current.delete(peerId);
      publishMeta();
    },
    [publishMeta]
  );

  const handleHostChannelMessage = useCallback(
    (peerId, event) => {
      const msg = parseChannelMessage(event);
      const peer = peersRef.current.get(peerId);
      const l = liveRef.current;
      if (!msg || !peer || !l || l.role !== 'host') return;

      if (msg.t === 'comment') {
        if (l.allowComments === false) return;
        const text = String(msg.text || '').trim().slice(0, LIVE_COMMENT_MAX);
        if (!text || !withinRate(peer.commentLog, COMMENT_BURST)) return;
        const comment = { id: newSignalId('comment'), from: { id: peerId, name: peer.name }, text, at: Date.now() };
        addComment(comment);
        broadcast({ t: 'comment', ...comment });
        return;
      }
      if (msg.t === 'reaction') {
        if (!LIVE_REACTIONS.includes(msg.emoji) || !withinRate(peer.reactionLog, REACTION_BURST)) return;
        showReaction(msg.emoji);
        // The sender already showed its own reaction locally.
        broadcast({ t: 'reaction', emoji: msg.emoji }, { except: peerId });
      }
    },
    [addComment, broadcast, showReaction]
  );

  const createHostPeer = useCallback(
    (viewerId, viewerInfo) => {
      const existing = peersRef.current.get(viewerId);
      if (existing) dropPeer(viewerId); // a viewer re-offering replaces its old link

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const keys = (viewerInfo?.publicKeys || []).filter((k) => /^[0-9a-f]{64}$/i.test(String(k)));
      const peer = {
        pc,
        channel: null,
        name: String(viewerInfo?.name || 'Viewer').slice(0, 64),
        keys,
        commentLog: [],
        reactionLog: [],
        dropTimer: null,
      };
      peersRef.current.set(viewerId, peer);

      const stream = localStreamRef.current;
      stream?.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        sendSignal('live:ice', viewerId, peer.keys, { type: 'ice', candidate: e.candidate.toJSON() });
      };
      pc.ondatachannel = (e) => {
        peer.channel = e.channel;
        e.channel.onopen = () => {
          const l = liveRef.current;
          sendJson(e.channel, {
            t: 'hello',
            comments: commentsRef.current.slice(-BACKLOG_COMMENTS),
            allowComments: l?.allowComments !== false,
            title: l?.title || '',
          });
          publishMeta();
        };
        e.channel.onmessage = (event) => handleHostChannelMessage(viewerId, event);
        e.channel.onclose = () => {
          if (peersRef.current.get(viewerId) === peer) dropPeer(viewerId);
        };
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          if (peer.dropTimer) window.clearTimeout(peer.dropTimer);
          peer.dropTimer = null;
          return;
        }
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          // Give a flaky network a moment; the viewer re-offers to recover.
          if (!peer.dropTimer) {
            peer.dropTimer = window.setTimeout(() => {
              if (peersRef.current.get(viewerId) === peer && pc.connectionState !== 'connected') dropPeer(viewerId);
            }, PEER_DROP_GRACE_MS);
          }
        }
        if (pc.connectionState === 'closed' && peersRef.current.get(viewerId) === peer) dropPeer(viewerId);
      };
      return peer;
    },
    [dropPeer, handleHostChannelMessage, publishMeta, sendSignal]
  );

  // ---- shared teardown ----------------------------------------------------

  const clearTimers = useCallback(() => {
    window.clearInterval(heartbeatTimerRef.current);
    window.clearInterval(statusTimerRef.current);
    window.clearTimeout(connectTimerRef.current);
    heartbeatTimerRef.current = null;
    statusTimerRef.current = null;
    connectTimerRef.current = null;
  }, []);

  const closeConnections = useCallback(() => {
    for (const peer of peersRef.current.values()) {
      if (peer.dropTimer) window.clearTimeout(peer.dropTimer);
      try {
        peer.channel?.close();
        peer.pc.close();
      } catch {
        /* ignore */
      }
    }
    peersRef.current.clear();
    const link = viewerLinkRef.current;
    if (link) {
      try {
        link.channel?.close();
        link.pc?.close();
      } catch {
        /* ignore */
      }
    }
    viewerLinkRef.current = null;
    pendingIceRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  const resetAll = useCallback(() => {
    clearTimers();
    closeConnections();
    commentsRef.current = [];
    peakRef.current = 0;
    setComments([]);
    setReactions([]);
    setViewers([]);
    setViewerCount(0);
    setMuted(false);
    setCameraOff(false);
    setConnection('idle');
    commitLive(null);
  }, [clearTimers, closeConnections, commitLive]);

  // ---- recording ----------------------------------------------------------

  const startRecorder = useCallback((stream) => {
    const mimeType = pickRecorderMimeType();
    if (mimeType === null) return false;
    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size) recorderChunksRef.current.push(e.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      return true;
    } catch {
      recorderRef.current = null;
      return false;
    }
  }, []);

  const stopRecorder = useCallback(
    () =>
      new Promise((resolve) => {
        const recorder = recorderRef.current;
        recorderRef.current = null;
        if (!recorder || recorder.state === 'inactive') {
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          const type = recorder.mimeType || 'video/webm';
          const blob = new Blob(recorderChunksRef.current, { type });
          recorderChunksRef.current = [];
          resolve(blob.size ? blob : null);
        };
        try {
          recorder.stop();
        } catch {
          resolve(null);
        }
      }),
    []
  );

  // ---- host API -----------------------------------------------------------

  const endBroadcast = useCallback(async () => {
    const l = liveRef.current;
    if (!l || l.role !== 'host' || l.status !== 'live') return;
    commitLive({ ...l, status: 'ending' });
    clearTimers();

    broadcast({ t: 'end' });
    // Sealed fallback for viewers whose data channel never opened. Must go
    // out before /end — the relay stops carrying live:* once it has ended.
    await Promise.all(
      [...peersRef.current.entries()].map(([peerId, peer]) =>
        sendSignal('live:end', peerId, peer.keys, { type: 'end' })
      )
    );
    endLive(l.streamId).catch(() => {});
    const blob = await stopRecorder();
    closeConnections();

    if (blob) {
      const isMp4 = blob.type.includes('mp4');
      const stamp = new Date(l.startedAt || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-');
      setRecording({
        url: URL.createObjectURL(blob),
        size: blob.size,
        mimeType: blob.type,
        filename: `quantumchat-live-${stamp}.${isMp4 ? 'mp4' : 'webm'}`,
        decision: 'pending',
      });
    }
    commitLive({
      ...l,
      status: 'ended',
      endedAt: Date.now(),
      summary: {
        peakViewers: peakRef.current,
        commentCount: commentsRef.current.length,
        durationSeconds: Math.max(0, Math.round((Date.now() - (l.startedAt || Date.now())) / 1000)),
      },
    });
  }, [broadcast, clearTimers, closeConnections, commitLive, sendSignal, stopRecorder]);

  const startBroadcast = useCallback(
    async ({ title = '', audience, record = false }) => {
      if (liveRef.current) throw new Error('You are already in a live stream');
      const media = await getCallMedia({ audio: true, video: true });
      let created;
      try {
        created = await startLive({ title, audience, record });
      } catch (err) {
        media.getTracks().forEach((t) => t.stop());
        throw err;
      }
      localStreamRef.current = media;
      setLocalStream(media);
      commentsRef.current = [];
      setComments([]);
      peakRef.current = 0;
      setRecording(null);

      const recordingStarted = record ? startRecorder(media) : false;
      commitLive({
        streamId: created.id,
        role: 'host',
        status: 'live',
        title: created.title || '',
        host: created.host,
        audienceType: created.audienceType,
        group: created.group,
        startedAt: Date.parse(created.startedAt) || Date.now(),
        allowComments: true,
        recordingEnabled: recordingStarted,
        recordingUnsupported: record && !recordingStarted,
      });

      heartbeatTimerRef.current = window.setInterval(async () => {
        const current = liveRef.current;
        if (!current || current.role !== 'host' || current.status !== 'live') return;
        const connected = [...peersRef.current.entries()]
          .filter(([, p]) => p.pc.connectionState === 'connected')
          .map(([id]) => id);
        try {
          const beat = await heartbeatLive(current.streamId, connected);
          for (const v of beat?.viewers || []) {
            const peer = peersRef.current.get(String(v.id));
            if (peer) peer.name = nameOf(v);
          }
        } catch (err) {
          // 410: ended elsewhere (e.g. another tab went live and replaced it).
          if (err?.response?.status === 410 || err?.response?.status === 404) endBroadcast();
        }
      }, HEARTBEAT_MS);
      return created;
    },
    [commitLive, endBroadcast, startRecorder]
  );

  const postHostComment = useCallback(
    (text) => {
      const l = liveRef.current;
      const clean = String(text || '').trim().slice(0, LIVE_COMMENT_MAX);
      if (!clean || !l || l.status !== 'live') return;
      if (l.role === 'host') {
        const comment = {
          id: newSignalId('comment'),
          from: { id: userId, name: nameOf(userRef.current), isHost: true },
          text: clean,
          at: Date.now(),
        };
        addComment(comment);
        broadcast({ t: 'comment', ...comment });
        return;
      }
      sendJson(viewerLinkRef.current?.channel, { t: 'comment', text: clean });
    },
    [addComment, broadcast, userId]
  );

  const sendReaction = useCallback(
    (emoji) => {
      const l = liveRef.current;
      if (!l || l.status !== 'live' || !LIVE_REACTIONS.includes(emoji)) return;
      showReaction(emoji);
      if (l.role === 'host') {
        broadcast({ t: 'reaction', emoji });
      } else {
        sendJson(viewerLinkRef.current?.channel, { t: 'reaction', emoji });
      }
    },
    [broadcast, showReaction]
  );

  const setAllowComments = useCallback(
    (allow) => {
      const l = liveRef.current;
      if (!l || l.role !== 'host') return;
      commitLive({ ...l, allowComments: Boolean(allow) });
      publishMeta();
    },
    [commitLive, publishMeta]
  );

  const inviteViewers = useCallback(async (userIds) => {
    const l = liveRef.current;
    if (!l || l.role !== 'host') return [];
    return inviteToLive(l.streamId, userIds);
  }, []);

  const removeViewer = useCallback(
    async (viewerId) => {
      const l = liveRef.current;
      if (!l || l.role !== 'host') return;
      sendJson(peersRef.current.get(viewerId)?.channel, { t: 'removed' });
      await removeLiveViewer(l.streamId, viewerId);
      dropPeer(viewerId);
    },
    [dropPeer]
  );

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    setMuted((prev) => {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = prev;
      });
      return !prev;
    });
  }, []);

  // Disabling (not removing) the track sends black frames, so viewers and
  // the recorder keep running without renegotiation.
  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    setCameraOff((prev) => {
      stream.getVideoTracks().forEach((t) => {
        t.enabled = prev;
      });
      return !prev;
    });
  }, []);

  const saveRecording = useCallback(() => {
    const rec = recordingRef.current;
    const l = liveRef.current;
    if (!rec) return;
    const a = document.createElement('a');
    a.href = rec.url;
    a.download = rec.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setRecording({ ...rec, decision: 'saved' });
    if (l?.streamId) setLiveRecordingDecision(l.streamId, 'saved').catch(() => {});
  }, []);

  const discardRecording = useCallback(() => {
    const rec = recordingRef.current;
    const l = liveRef.current;
    if (!rec) return;
    URL.revokeObjectURL(rec.url);
    setRecording(null);
    if (l?.streamId && rec.decision === 'pending') {
      setLiveRecordingDecision(l.streamId, 'discarded').catch(() => {});
    }
  }, []);

  // ---- viewer API ---------------------------------------------------------

  const markViewerEnded = useCallback(
    (reason) => {
      const l = liveRef.current;
      if (!l || l.role !== 'viewer' || l.status === 'ended') return;
      clearTimers();
      closeConnections();
      commitLive({ ...l, status: 'ended', endReason: reason });
    },
    [clearTimers, closeConnections, commitLive]
  );

  const handleViewerChannelMessage = useCallback(
    (event) => {
      const msg = parseChannelMessage(event);
      if (!msg) return;
      if (msg.t === 'hello') {
        const backlog = Array.isArray(msg.comments) ? msg.comments.slice(-BACKLOG_COMMENTS) : [];
        commentsRef.current = backlog;
        setComments(backlog);
        const l = liveRef.current;
        if (l) commitLive({ ...l, allowComments: msg.allowComments !== false, title: msg.title ?? l.title });
      } else if (msg.t === 'comment') {
        if (typeof msg.text !== 'string' || !msg.id) return;
        addComment({
          id: String(msg.id),
          from: { id: String(msg.from?.id || ''), name: String(msg.from?.name || 'Viewer'), isHost: Boolean(msg.from?.isHost) },
          text: msg.text.slice(0, LIVE_COMMENT_MAX),
          at: Number(msg.at) || Date.now(),
        });
      } else if (msg.t === 'reaction') {
        if (LIVE_REACTIONS.includes(msg.emoji)) showReaction(msg.emoji);
      } else if (msg.t === 'meta') {
        setViewerCount(Number(msg.viewerCount) || 0);
        const l = liveRef.current;
        if (l) commitLive({ ...l, allowComments: msg.allowComments !== false, title: msg.title ?? l.title });
      } else if (msg.t === 'end') {
        markViewerEnded('host');
      } else if (msg.t === 'removed') {
        markViewerEnded('removed');
      }
    },
    [addComment, commitLive, markViewerEnded, showReaction]
  );

  const negotiateViewer = useCallback(async () => {
    const l = liveRef.current;
    const prev = viewerLinkRef.current;
    if (!l || l.role !== 'viewer' || !prev) return;
    try {
      prev.channel?.close();
      prev.pc?.close();
    } catch {
      /* ignore */
    }
    pendingIceRef.current.clear();
    setConnection('connecting');
    setRemoteStream(null);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const channel = pc.createDataChannel('live', { ordered: true });
    const link = { ...prev, pc, channel };
    viewerLinkRef.current = link;

    channel.onmessage = handleViewerChannelMessage;
    const inbound = new MediaStream();
    pc.ontrack = (e) => {
      if (!inbound.getTracks().includes(e.track)) inbound.addTrack(e.track);
      setRemoteStream(new MediaStream(inbound.getTracks()));
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      sendSignal('live:ice', link.hostId, link.hostKeys, { type: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (viewerLinkRef.current !== link) return;
      if (pc.connectionState === 'connected') {
        window.clearTimeout(connectTimerRef.current);
        setConnection('connected');
      } else if (pc.connectionState === 'failed') {
        setConnection('failed');
      } else if (pc.connectionState === 'disconnected') {
        setConnection('reconnecting');
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const me = userRef.current;
    await sendSignal('live:offer', link.hostId, link.hostKeys, {
      type: 'offer',
      sdp: offer,
      viewer: { name: nameOf(me), publicKeys: me?.publicKeys || [] },
    });

    window.clearTimeout(connectTimerRef.current);
    connectTimerRef.current = window.setTimeout(() => {
      if (viewerLinkRef.current === link && pc.connectionState !== 'connected') setConnection('failed');
    }, CONNECT_TIMEOUT_MS);
  }, [handleViewerChannelMessage, sendSignal]);

  const watch = useCallback(
    async (streamId) => {
      const id = String(streamId || '');
      if (!id) return;
      const current = liveRef.current;
      if (current) {
        if (current.streamId === id) return;
        throw new Error('Leave your current live stream first');
      }
      commitLive({ streamId: id, role: 'viewer', status: 'joining' });
      setConnection('connecting');
      let joined;
      try {
        joined = await joinLive(id);
      } catch (err) {
        resetAll();
        throw err;
      }
      const s = joined.stream;
      commentsRef.current = [];
      setComments([]);
      setViewerCount(s.viewerCount || 0);
      viewerLinkRef.current = { hostId: String(s.host?.id), hostKeys: joined.hostPublicKeys || [] };
      commitLive({
        streamId: id,
        role: 'viewer',
        status: 'live',
        title: s.title || '',
        host: s.host,
        audienceType: s.audienceType,
        group: s.group,
        startedAt: Date.parse(s.startedAt) || Date.now(),
        allowComments: true,
      });

      statusTimerRef.current = window.setInterval(async () => {
        const l = liveRef.current;
        if (!l || l.role !== 'viewer' || l.status !== 'live') return;
        try {
          const latest = await getLive(l.streamId);
          if (latest.status !== 'live') markViewerEnded('host');
        } catch (err) {
          if (err?.response?.status === 403) markViewerEnded('removed');
          if (err?.response?.status === 404) markViewerEnded('host');
        }
      }, VIEWER_STATUS_POLL_MS);

      await negotiateViewer();
    },
    [commitLive, markViewerEnded, negotiateViewer, resetAll]
  );

  const reconnect = useCallback(() => {
    negotiateViewer().catch(() => setConnection('failed'));
  }, [negotiateViewer]);

  const leave = useCallback(() => {
    const l = liveRef.current;
    if (!l) return;
    if (l.role === 'viewer' && l.status === 'live') {
      const link = viewerLinkRef.current;
      if (link) sendSignal('live:leave', link.hostId, link.hostKeys, { type: 'leave' });
      leaveLive(l.streamId).catch(() => {});
    }
    if (l.role === 'host' && l.status === 'live') {
      // Callers should end via endBroadcast; this is the "close anyway" path.
      endBroadcast();
      return;
    }
    if (recordingRef.current?.decision === 'pending') discardRecording();
    else if (recordingRef.current) {
      URL.revokeObjectURL(recordingRef.current.url);
      setRecording(null);
    }
    resetAll();
  }, [discardRecording, endBroadcast, resetAll, sendSignal]);

  // ---- signaling ----------------------------------------------------------

  useEffect(() => {
    if (!userId) return undefined;
    const socket = getSocket();

    async function flushIce(pc, peerId) {
      const queued = pendingIceRef.current.get(peerId) || [];
      pendingIceRef.current.delete(peerId);
      for (const candidate of queued) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
    }

    function matches(callId) {
      const l = liveRef.current;
      return l && l.streamId === String(callId) && (l.status === 'live' || l.status === 'joining');
    }

    async function onOffer({ from, callId, envelope }) {
      const l = liveRef.current;
      if (!matches(callId) || l.role !== 'host') return;
      const body = unsealCallEnvelope(envelope, userId);
      if (!body || body.type !== 'offer' || !body.sdp) return;
      const viewerId = String(from);
      const peer = createHostPeer(viewerId, body.viewer);
      try {
        await peer.pc.setRemoteDescription(body.sdp);
        await flushIce(peer.pc, viewerId);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        await sendSignal('live:answer', viewerId, peer.keys, { type: 'answer', sdp: answer });
      } catch {
        dropPeer(viewerId);
      }
    }

    async function onAnswer({ from, callId, envelope }) {
      const l = liveRef.current;
      const link = viewerLinkRef.current;
      if (!matches(callId) || l.role !== 'viewer' || !link?.pc || String(from) !== link.hostId) return;
      const body = unsealCallEnvelope(envelope, userId);
      if (!body || body.type !== 'answer' || !body.sdp) return;
      if (link.pc.signalingState !== 'have-local-offer') return;
      await link.pc.setRemoteDescription(body.sdp).catch(() => setConnection('failed'));
      await flushIce(link.pc, link.hostId);
    }

    async function onIce({ from, callId, envelope }) {
      const l = liveRef.current;
      if (!matches(callId)) return;
      const body = unsealCallEnvelope(envelope, userId);
      if (!body || body.type !== 'ice' || !body.candidate) return;
      const peerId = String(from);
      const pc = l.role === 'host'
        ? peersRef.current.get(peerId)?.pc
        : viewerLinkRef.current?.hostId === peerId ? viewerLinkRef.current.pc : null;
      if (!pc || !pc.remoteDescription) {
        const list = pendingIceRef.current.get(peerId) || [];
        list.push(body.candidate);
        pendingIceRef.current.set(peerId, list);
        return;
      }
      await pc.addIceCandidate(body.candidate).catch(() => {});
    }

    function onLeave({ from, callId, envelope }) {
      const l = liveRef.current;
      if (!matches(callId) || l.role !== 'host') return;
      const body = unsealCallEnvelope(envelope, userId);
      if (body?.type === 'leave') dropPeer(String(from));
    }

    function onEndSignal({ from, callId, envelope }) {
      const l = liveRef.current;
      if (!matches(callId) || l.role !== 'viewer' || String(from) !== viewerLinkRef.current?.hostId) return;
      const body = unsealCallEnvelope(envelope, userId);
      if (body?.type === 'end') markViewerEnded('host');
    }

    // Plain (unsealed) server notices — they carry only the stream id.
    function onServerEnded({ id }) {
      const l = liveRef.current;
      if (!l || l.streamId !== String(id)) return;
      if (l.role === 'viewer') markViewerEnded('host');
      else if (l.role === 'host' && l.status === 'live') endBroadcast();
    }
    function onServerRemoved({ id }) {
      const l = liveRef.current;
      if (l?.role === 'viewer' && l.streamId === String(id)) markViewerEnded('removed');
    }

    const handlers = {
      'live:offer': onOffer,
      'live:answer': onAnswer,
      'live:ice': onIce,
      'live:leave': onLeave,
      'live:end': onEndSignal,
    };
    for (const [eventName, handler] of Object.entries(handlers)) socket?.on(eventName, handler);
    socket?.on('live:ended', onServerEnded);
    socket?.on('live:removed', onServerRemoved);
    const unregisterRestFallback = registerSignalHandlers(handlers);

    return () => {
      unregisterRestFallback();
      for (const [eventName, handler] of Object.entries(handlers)) socket?.off(eventName, handler);
      socket?.off('live:ended', onServerEnded);
      socket?.off('live:removed', onServerRemoved);
    };
  }, [userId, createHostPeer, dropPeer, endBroadcast, markViewerEnded, sendSignal]);

  // Closing the tab mid-stream: tell the server right away instead of
  // leaving viewers staring at a frozen frame until the heartbeat times out.
  useEffect(() => {
    function onPageHide() {
      const l = liveRef.current;
      if (!l || l.status !== 'live') return;
      if (l.role === 'host') {
        broadcast({ t: 'end' });
        keepaliveRequest(`/live/${l.streamId}/end`);
      } else {
        keepaliveRequest(`/live/${l.streamId}/leave`);
      }
    }
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [broadcast]);

  useEffect(
    () => () => {
      clearTimers();
      closeConnections();
      if (recorderRef.current?.state === 'recording') {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
    },
    [clearTimers, closeConnections]
  );

  return {
    live,
    localStream,
    remoteStream,
    viewerCount,
    viewers,
    comments,
    reactions,
    muted,
    cameraOff,
    connection,
    recording,
    startBroadcast,
    endBroadcast,
    watch,
    reconnect,
    leave,
    postComment: postHostComment,
    sendReaction,
    setAllowComments,
    inviteViewers,
    removeViewer,
    toggleMute,
    toggleCamera,
    saveRecording,
    discardRecording,
  };
}
