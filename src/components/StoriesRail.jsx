import { Camera, Eye, ImagePlus, Mic, Paperclip, Pencil, Send, Smile, Square, Type, X } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import client from '../api/client.js';
import { getSocket } from '../api/socket.js';
import { useAuth } from '../context/AuthContext.jsx';
import { KEY_SET_SIZE, pickRandom, sealBytes, sealMessage, unsealMessage } from '../crypto/keys.js';
import {
  findSecretKeyForPublicKey,
  getCurrentKeySet,
  getKeyring,
  getKeyringSyncStatus,
  getStoredUser
} from '../crypto/keyStorage.js';
import { COMPOSER_EMOJIS, searchEmojis } from '../utils/emojis.js';
import { playNotificationSound, shouldNotify, showNotificationPopup } from '../utils/notificationDispatch.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import TextStoryComposer from './TextStoryComposer.jsx';
import UserAvatar from './UserAvatar.jsx';
const MAX_STORY_SECONDS = 60;
const TTL_PRESETS = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
];
const DEFAULT_TTL_MS = TTL_PRESETS[2].ms; // 24h
const MIN_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(b64) {
  // Multipart form fields sometimes turn '+' into spaces; normalize before atob.
  const normalized = String(b64 || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/\s/g, '');
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesGcmEncryptBlob(file) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(await file.arrayBuffer());

  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return {
    cipherBytes: new Uint8Array(cipherBuf),
    keyB64: bytesToBase64(rawKey),
    ivB64: bytesToBase64(iv),
  };
}

async function aesGcmDecryptBytes(cipherBytes, keyB64, ivB64) {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(keyB64),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivB64) },
    key,
    cipherBytes
  );
  return new Uint8Array(plain);
}

function probeMediaDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');
    const el = document.createElement(isVideo ? 'video' : 'audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      const durationMs = Math.round((el.duration || 0) * 1000);
      URL.revokeObjectURL(url);
      resolve(durationMs);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read media duration'));
    };
    el.src = url;
  });
}

function envelopeUserId(envelope) {
  return String(envelope?.user?.id || envelope?.user || '');
}

function buildStoryEnvelopes(audience, keyB64, ivB64) {
  const secretPayload = JSON.stringify({ keyB64, ivB64 });
  return audience.map((u) => {
    const keys = (u.publicKeys || []).filter(Boolean);
    if (!keys.length) throw new Error(`Missing X5 keys for ${u.username || u.id}`);
    const sealed = sealMessage(secretPayload, pickRandom(keys));
    return { user: String(u.id), ...sealed };
  });
}

function tryParseKeyPayload(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.keyB64 && parsed?.ivB64) return parsed;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Open the AES media key from any of this viewer's story envelopes.
 * Returns { ok: true, payload } on success, or { ok: false, reason, targetPublicKey? }
 * so the UI can show a precise message (no envelope vs. no matching secret vs. decrypt failure).
 */
function unlockStoryKey(story, currentUserId) {
  const uid = String(currentUserId?.id || currentUserId || '');
  if (!uid) return { ok: false, reason: 'no-envelope' };

  const envelopes = (story.envelopes || []).filter((e) => envelopeUserId(e) === uid);
  if (!envelopes.length) return { ok: false, reason: 'no-envelope' };

  const ring = getKeyring(uid);

  for (const envelope of envelopes) {
    const hinted = envelope.targetPublicKey
      ? findSecretKeyForPublicKey(uid, envelope.targetPublicKey)
      : null;

    if (hinted) {
      const payload = tryParseKeyPayload(unsealMessage(envelope, hinted));
      if (payload) return { ok: true, payload };
    }

    // Fallback: try every local secret (covers a stale/mismatched targetPublicKey hint).
    for (const entry of ring) {
      if (hinted && entry.secretKey === hinted) continue;
      const payload = tryParseKeyPayload(unsealMessage(envelope, entry.secretKey));
      if (payload) return { ok: true, payload };
    }
  }

  return {
    ok: false,
    reason: 'no-secret',
    targetPublicKey: envelopes[0]?.targetPublicKey,
  };
}

function viewerCanSeeStory(story, currentUserId) {
  if (!story?.sealed) return true;
  const uid = String(currentUserId?.id || currentUserId || '');
  return (story.envelopes || []).some((e) => envelopeUserId(e) === uid);
}

/** Session cache of decrypted story object URLs — reopening a status is instant. */
const storyMediaCache = new Map();

function cacheKeyForStory(story) {
  return `${story.id}:${story.sealed ? '1' : '0'}:${story.contentIv || ''}`;
}

function formatElapsed(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatRemaining(expiresAtStr) {
  if (!expiresAtStr) return '';
  const diffMs = new Date(expiresAtStr).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h left` : `${days}d left`;
}

const StoriesRail = forwardRef(function StoriesRail({ currentUser, users = [], onError, notifSettings }, ref) {
  const { keyringInSync, keyringNeedsResync, refreshUserFromServer, verifyKeySync } = useAuth();
  const [stories, setStories] = useState([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [textComposerOpen, setTextComposerOpen] = useState(false);
  const [fabHost, setFabHost] = useState(null);
  const mediaInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const grouped = useMemo(() => {
    const map = new Map();
    for (const story of stories) {
      if (!viewerCanSeeStory(story, currentUser?.id)) continue;
      const uid = String(story.user?.id || story.user);
      if (!map.has(uid)) {
        map.set(uid, { user: story.user, items: [] });
      }
      map.get(uid).items.push(story);
    }
    const list = [...map.values()];
    // Server returns stories newest-first; playback should go oldest → newest.
    for (const group of list) {
      group.items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }
    list.sort((a, b) => {
      const aOwn = String(a.user?.id) === String(currentUser?.id);
      const bOwn = String(b.user?.id) === String(currentUser?.id);
      if (aOwn && !bOwn) return -1;
      if (!aOwn && bOwn) return 1;
      return 0;
    });
    return list;
  }, [stories, currentUser?.id]);

  async function loadStories() {
    setStoriesLoading(true);
    try {
      const { data } = await client.get('/stories');
      setStories(data.data || []);
    } catch {
      setStories([]);
    } finally {
      setStoriesLoading(false);
    }
  }

  useEffect(() => {
    loadStories().catch(() => { });
  }, []);

  useEffect(() => {
  const socket = getSocket();
  if (!socket) return undefined;
  function onNew(payload) {
    if (!payload?.id) return;
    if (!viewerCanSeeStory(payload, currentUser?.id)) return;
    const isOwn = String(payload.user?.id) === String(currentUser?.id);
    setStories((prev) => {
      if (prev.some((s) => String(s.id) === String(payload.id))) return prev;
      return [payload, ...prev];
    });

    if (!isOwn) {
      const mode = notifSettings?.statusNotifications;
      const isSelected = (notifSettings?.statusNotificationsSelectedFriends || [])
        .map(String)
        .includes(String(payload.user?.id));
      const allowed = mode !== 'off' && (mode !== 'selected' || isSelected);
      if (allowed && shouldNotify(notifSettings, { kind: 'status' })) {
        playNotificationSound(notifSettings);
        showNotificationPopup(
          { title: payload.user?.username || 'Someone', body: 'Posted a new story' },
          notifSettings,
          () => {},
        );
      }
    }
  }
  function onDeleted({ id } = {}) {
    if (!id) return;
    setStories((prev) => prev.filter((s) => String(s.id) !== String(id)));
  }
  socket.on('story:new', onNew);
  socket.on('story:deleted', onDeleted);
  return () => {
    socket.off('story:new', onNew);
    socket.off('story:deleted', onDeleted);
  };
}, [currentUser?.id, currentUser?.friends, notifSettings]);

  useEffect(() => {
    setFabHost(document.querySelector('.qc-conversation-pane'));
  }, []);

  const ownGroup = useMemo(
    () => grouped.find((g) => String(g.user?.id) === String(currentUser?.id)) || null,
    [grouped, currentUser?.id]
  );

  useEffect(() => {
    if (!createSheetOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setCreateSheetOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [createSheetOpen]);

  function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setCreateSheetOpen(false);
    setTextComposerOpen(false);
    setPendingFile(file);
    setPendingPreviewUrl(URL.createObjectURL(file));
  }

  function openCreateSheet() {
    if (uploading) return;
    setCreateSheetOpen(true);
  }

  function openOwnStoriesOrCreate() {
    if (uploading) return;
    if (ownGroup?.items?.length) {
      setUnavailable(false);
      setViewer({ group: ownGroup, index: 0 });
      return;
    }
    openCreateSheet();
  }


  async function uploadStory(file, ttlMs, allowReplies = true) {
    try {
      setUploading(true);

      // Make sure our local keyring is actually in sync with the server before
      // sealing anything to it — this is the fix for stories being undecryptable.
      if (keyringNeedsResync || !keyringInSync) {
        await verifyKeySync().catch(() => refreshUserFromServer().catch(() => null));
      }
      const ownerUser = getStoredUser() || currentUser;
      const sync = getKeyringSyncStatus(ownerUser.id, ownerUser.publicKeys || []);
      if (sync.status !== 'synced') {
        onError?.(
          'Encryption keys are out of sync with the server. Use Settings → Regenerate & resync keys before posting stories.'
        );
        return false;
      }

      let durationMs = 0;
      if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
        durationMs = await probeMediaDuration(file);
        if (durationMs > MAX_STORY_SECONDS * 1000) {
          onError?.(`Stories must be ${MAX_STORY_SECONDS} seconds or shorter`);
          return false;
        }
      }

      const form = new FormData();
      const canSeal = typeof crypto !== 'undefined' && crypto.subtle;

      if (canSeal) {
        const sealed = await aesGcmEncryptBlob(file);

        // Seal the author envelope to keys this device actually holds (same
        // pattern as chat forSender), not a possibly stale session publicKeys list.
        const ownerKeySet = getCurrentKeySet(ownerUser.id, KEY_SET_SIZE);
        const ownerPublicKeys = ownerKeySet.map((k) => k.publicKey).filter(Boolean);
        if (ownerPublicKeys.length !== KEY_SET_SIZE) {
          throw new Error('Your local keyring is incomplete — import keys.txt or regenerate keys');
        }
        for (const pk of ownerPublicKeys) {
          if (!findSecretKeyForPublicKey(ownerUser.id, pk)) {
            throw new Error('Local keyring is incomplete — re-import your keys.txt');
          }
        }

        const storyPrivacy = currentUser?.privacy?.story || 'everyone';
        const friendSet = new Set((currentUser?.friends || []).map(String));
        const selectedSet = new Set((currentUser?.privacy?.storyViewers || []).map(String));

        const audienceMap = new Map();
        audienceMap.set(String(ownerUser.id), {
          id: String(ownerUser.id),
          username: ownerUser.username,
          publicKeys: ownerPublicKeys,
        });
        for (const u of users) {
          if (!u?.id || !u.publicKeys?.length) continue;
          if (String(u.id) === String(ownerUser.id)) continue;
           // --- Story privacy filter
          if (storyPrivacy === 'nobody') continue;
          if (storyPrivacy === 'friends' && !friendSet.has(String(u.id))) continue;
          if (storyPrivacy === 'selected' && !selectedSet.has(String(u.id))) continue;
          audienceMap.set(String(u.id), {
            id: String(u.id),
            username: u.username,
            publicKeys: u.publicKeys,
          });
        }
        const audience = [...audienceMap.values()];
        if (!audience[0].publicKeys?.length) {
          throw new Error('Your account is missing X5 public keys');
        }

        const serverKeys = new Set((ownerUser.publicKeys || []).map((k) => k.toLowerCase()));
        const localKeys = new Set(ownerPublicKeys.map((k) => k.toLowerCase()));
        const keysMatchServer = ownerPublicKeys.every((k) => serverKeys.has(k.toLowerCase()));
        if (!keysMatchServer || serverKeys.size !== localKeys.size) {
          throw new Error(
            'Local encryption keys do not match the server — regenerate & resync keys before posting stories'
          );
        }

        const envelopes = buildStoryEnvelopes(audience, sealed.keyB64, sealed.ivB64);

        form.append(
          'file',
          new Blob([sealed.cipherBytes], { type: 'application/octet-stream' }),
          file.name || 'story.bin'
        );
        form.append('sealed', 'true');
        form.append('mimetype', file.type || 'application/octet-stream');
        if (file.type.startsWith('image/')) form.append('mediaType', 'image');
        else if (file.type.startsWith('video/')) form.append('mediaType', 'video');
        else if (file.type.startsWith('audio/')) form.append('mediaType', 'audio');
        form.append('contentIv', sealed.ivB64);
        form.append('envelopes', JSON.stringify(envelopes));
      } else {
        form.append('file', file);
      }
      form.append('durationMs', String(durationMs));
      form.append('ttlMs', String(ttlMs));
      form.append('allowReplies', String(allowReplies));

      await client.post('/stories', form);
      await loadStories();
      return true;
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to upload story');
      return false;
    } finally {
      setUploading(false);
    }
  }

  function closeComposer() {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingFile(null);
    setPendingPreviewUrl(null);
    setTextComposerOpen(false);
  }

  async function confirmPostStory(ttlMs, allowReplies) {
    const file = pendingFile;
    if (!file || uploading) return;
    const ok = await uploadStory(file, ttlMs, allowReplies);
    if (ok) closeComposer();
  }

  async function confirmPostTextStory(file, ttlMs, allowReplies) {
    if (!file || uploading) return;
    const ok = await uploadStory(file, ttlMs, allowReplies);
    if (ok) closeComposer();
  }

  useImperativeHandle(ref, () => ({
    async openStoryById(storyId) {
      try {
        const { data } = await client.get(`/stories/${storyId}`);
        const story = data.data;
        setUnavailable(false);
        setViewer({ group: { user: story.user, items: [story] }, index: 0 });
      } catch {
        setUnavailable(true);
      }
    },
  }));

  return (
    <div className="stories-rail">
      <p className="stories-privacy-note">
        Sealed stories use X5 envelopes so allowed contacts can decrypt; the server only stores ciphertext.
      </p>

      <div className="story-add-wrap">
        <button
          type="button"
          className={`story-ring add${uploading ? ' uploading' : ''}${ownGroup?.items?.length ? ' has-own' : ''}`}
          onClick={openOwnStoriesOrCreate}
          disabled={uploading}
          aria-label={ownGroup?.items?.length ? 'View your status' : 'Add status'}
        >
          <UserAvatar
            userId={currentUser?.id}
            name={currentUser?.username}
            hasAvatar={currentUser?.hasAvatar}
            size="story"
          />
          <span className="story-ring-label">{uploading ? 'Uploading…' : 'My status'}</span>
        </button>
        <button
          type="button"
          className="story-add-badge"
          disabled={uploading}
          aria-label="Add status"
          onClick={openCreateSheet}
        >
          {uploading ? '…' : '+'}
        </button>
      </div>

      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={handleFileSelected}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={handleFileSelected}
      />

      {storiesLoading &&
        [1, 2, 3].map((i) => (
          <div key={i} className="story-ring story-ring-skeleton" aria-hidden="true">
            <div className="skeleton skeleton-avatar story-skeleton-avatar" />
            <span className="skeleton skeleton-line story-skeleton-label" />
          </div>
        ))}

      {!storiesLoading &&
        grouped
          .filter((g) => String(g.user?.id) !== String(currentUser?.id))
          .map((g) => {
            const hasSealed = g.items.some((s) => s.sealed);
            return (
              <button
                key={String(g.user?.id)}
                type="button"
                className={`story-ring${hasSealed ? ' sealed' : ''}`}
                onClick={() => {
                  setUnavailable(false);
                  setViewer({ group: g, index: 0 });
                }}
              >
                <UserAvatar
                  userId={g.user?.id}
                  name={g.user?.username}
                  hasAvatar={g.user?.hasAvatar}
                  size="story"
                />
                {hasSealed ? <span className="story-ring-sealed-dot" title="Sealed story" aria-label="Sealed" /> : null}
                <span className="story-ring-label">{g.user?.username}</span>
              </button>
            );
          })}

      {viewer && (
        <StoryViewer
          group={viewer.group}
          startIndex={viewer.index}
          currentUserId={currentUser?.id}
          users={users}
          onError={onError}
          onClose={() => setViewer(null)}
          onDeleted={async () => {
            setViewer(null);
            await loadStories();
          }}
        />
      )}
      {unavailable && (
        <div className="story-viewer-overlay" onClick={() => setUnavailable(false)}>
          <div className="story-unavailable-card" onClick={(e) => e.stopPropagation()}>
            <p className="story-unavailable-title">Story unavailable</p>
            <p>This story expired or was deleted.</p>
            <button type="button" onClick={() => setUnavailable(false)}>
              OK
            </button>
          </div>
        </div>
      )}
      {pendingFile && (
        <StoryComposer
          file={pendingFile}
          previewUrl={pendingPreviewUrl}
          onCancel={closeComposer}
          onConfirm={confirmPostStory}
          uploading={uploading}
        />
      )}
      {textComposerOpen && !pendingFile && (
        <TextStoryComposer
          onCancel={() => setTextComposerOpen(false)}
          onConfirm={confirmPostTextStory}
          uploading={uploading}
          onError={onError}
        />
      )}

      {createSheetOpen &&
        createPortal(
          <div
            className="status-create-overlay"
            onClick={() => setCreateSheetOpen(false)}
            role="presentation"
          >
            <div
              className="status-create-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Add status"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="status-create-handle" aria-hidden />
              <h2 className="status-create-title">Add status</h2>
              <p className="status-create-subtitle">Share a photo, video, voice note, or text</p>
              <div className="status-create-options">
                <button
                  type="button"
                  className="status-create-option"
                  onClick={() => {
                    setCreateSheetOpen(false);
                    mediaInputRef.current?.click();
                  }}
                >
                  <span className="status-create-icon media">
                    <ImagePlus size={22} aria-hidden />
                  </span>
                  <span className="status-create-copy">
                    <strong>Photo &amp; video</strong>
                    <small>Upload from your gallery</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="status-create-option"
                  onClick={() => {
                    setCreateSheetOpen(false);
                    audioInputRef.current?.click();
                  }}
                >
                  <span className="status-create-icon audio">
                    <Mic size={22} aria-hidden />
                  </span>
                  <span className="status-create-copy">
                    <strong>Voice note</strong>
                    <small>Share an audio status</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="status-create-option"
                  onClick={() => {
                    setCreateSheetOpen(false);
                    setTextComposerOpen(true);
                  }}
                >
                  <span className="status-create-icon text">
                    <Type size={22} aria-hidden />
                  </span>
                  <span className="status-create-copy">
                    <strong>Text status</strong>
                    <small>Type with colors and fonts</small>
                  </span>
                </button>
              </div>
              <button
                type="button"
                className="status-create-cancel"
                onClick={() => setCreateSheetOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body
        )}

      {!uploading &&
        !pendingFile &&
        !textComposerOpen &&
        !createSheetOpen &&
        !viewer &&
        fabHost &&
        createPortal(
          <div className="status-fabs" aria-label="Create status">
            <button
              type="button"
              className="status-fab text"
              title="Text status"
              aria-label="Text status"
              onClick={() => setTextComposerOpen(true)}
            >
              <Pencil size={20} aria-hidden />
            </button>
            <button
              type="button"
              className="status-fab camera"
              title="Add status"
              aria-label="Add photo, video, or other status"
              onClick={openCreateSheet}
            >
              <Camera size={24} aria-hidden />
            </button>
          </div>,
          fabHost
        )}
    </div>
  );
});

export default StoriesRail;

/** Full-screen "Viewed by N" sheet, opened from the eye icon in StoryViewer. */
function StoryViewersSheet({ viewerCount, viewers, onClose }) {
  return (
    <div className="story-viewers-sheet-overlay" onClick={onClose}>
      <div className="story-viewers-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="story-viewers-sheet-header">
          <span>Viewed by {viewerCount}</span>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="story-viewers-sheet-list">
          {viewers.length === 0 ? (
            <p className="empty-hint">No views yet</p>
          ) : (
            viewers.map((v) => (
              <div key={v.id} className="story-viewers-sheet-row">
                <UserAvatar userId={v.id} name={v.username} hasAvatar={v.hasAvatar} size="sm" />
                <span className="story-viewers-sheet-name">{v.username}</span>
                <span className="story-viewers-sheet-time">
                  {new Date(v.viewedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StoryViewer({ group, startIndex, currentUserId, users = [], onClose, onDeleted, onError }) {
  const [viewerCount, setViewerCount] = useState(0);
  const [viewers, setViewers] = useState([]);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [index, setIndex] = useState(startIndex || 0);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [blockedReason, setBlockedReason] = useState('');
  const [loadPhase, setLoadPhase] = useState(''); // '', 'download', 'decrypt'
  const [downloadPct, setDownloadPct] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const replyInputRef = useRef(null);
  const [reacting, setReacting] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState('');
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactionQuery, setReactionQuery] = useState('');
  const [burst, setBurst] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const replyFileInputRef = useRef(null);
  const [replyRecording, setReplyRecording] = useState(false);
  const [replyRecordSeconds, setReplyRecordSeconds] = useState(0);
  const replyMediaRecorderRef = useRef(null);
  const replyMediaStreamRef = useRef(null);
  const replyRecordChunksRef = useRef([]);
  const replyRecordTimerRef = useRef(null);
  const replyRecordStartedAtRef = useRef(0);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState([]);
  const [gifLoading, setGifLoading] = useState(false);

  const story = group.items[index];
  const isOwn = String(group.user?.id) === String(currentUserId);

  useEffect(() => {
    const abortController = new AbortController();
    let objectUrl;
    let usedCache = false;

    setMediaUrl(null);
    setBlockedReason('');
    setLoadPhase('');
    setDownloadPct(null);

    if (!isOwn) {
      client.post(`/stories/${story.id}/view`).catch(() => {
        // Non-critical — a failed view-ping shouldn't block story viewing.
      });
    }

    (async () => {
      const cacheKey = cacheKeyForStory(story);
      const cached = storyMediaCache.get(cacheKey);
      if (cached) {
        usedCache = true;
        setMediaUrl(cached);
        return;
      }

      if (story.sealed) {
        const unlocked = unlockStoryKey(story, currentUserId);
        const ivB64 = unlocked?.payload?.ivB64 || story.contentIv;

        if (!unlocked?.ok || !unlocked?.payload?.keyB64 || !ivB64) {
          setBlockedReason('Sealed story — no envelope for your keys');
          return;
        }

        setLoadPhase('download');
        const res = await client.get(`/stories/${story.id}/media`, {
          responseType: 'arraybuffer',
          signal: abortController.signal,
          timeout: 90_000,
          onDownloadProgress: (evt) => {
            if (!evt.total) return;
            setDownloadPct(Math.min(99, Math.round((evt.loaded / evt.total) * 100)));
          },
        });

        if (abortController.signal.aborted) return;

        setLoadPhase('decrypt');
        setDownloadPct(100);
        await new Promise((r) => requestAnimationFrame(() => r()));

        const cipherBytes = new Uint8Array(res.data);
        const plain = await aesGcmDecryptBytes(cipherBytes, unlocked.payload.keyB64, ivB64);

        if (abortController.signal.aborted) return;

        objectUrl = URL.createObjectURL(
          new Blob([plain], { type: story.mimetype || 'application/octet-stream' })
        );
        storyMediaCache.set(cacheKey, objectUrl);
        setMediaUrl(objectUrl);
        setLoadPhase('');
        return;
      }

      setLoadPhase('download');
      const res = await client.get(`/stories/${story.id}/media`, {
        responseType: 'blob',
        signal: abortController.signal,
        timeout: 90_000,
        onDownloadProgress: (evt) => {
          if (!evt.total) return;
          setDownloadPct(Math.min(99, Math.round((evt.loaded / evt.total) * 100)));
        },
      });

      if (abortController.signal.aborted) return;

      objectUrl = URL.createObjectURL(res.data);
      storyMediaCache.set(cacheKey, objectUrl);
      setMediaUrl(objectUrl);
      setLoadPhase('');
    })().catch((err) => {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;

      setMediaUrl(null);
      setLoadPhase('');

      if (story.sealed) {
        const status = err?.response?.status;
        if (status === 403) {
          setBlockedReason('Sealed story — no envelope for your keys');
        } else if (status === 404) {
          setBlockedReason('Story media is missing on the server');
        } else if (err.code === 'ECONNABORTED') {
          setBlockedReason('Status download timed out — try again');
        } else {
          setBlockedReason('Could not decrypt this sealed story');
        }
      } else {
        setBlockedReason(
          err.code === 'ECONNABORTED'
            ? 'Status download timed out — try again'
            : 'Failed to load story media'
        );
      }
    });

    return () => {
      abortController.abort();
      // Keep session-cached URLs alive; only revoke uncached blobs.
      if (objectUrl && !usedCache) {
        const key = cacheKeyForStory(story);
        if (storyMediaCache.get(key) !== objectUrl) URL.revokeObjectURL(objectUrl);
      }
    };
  }, [story.id, story.sealed, story.contentIv, story.mimetype, currentUserId]);

  useEffect(() => {
    if (!isOwn) return;
    const socket = getSocket();

    if (!socket) {
      // No persistent Socket.IO connection available — e.g. production on
      // Vercel, whose serverless API can't hold a live socket unless
      // VITE_SIGNAL_URL points at a dedicated always-on signaling server.
      // Fall back to periodic REST polling so the viewer list still stays
      // reasonably fresh while this story is open, instead of just going
      // silent for the rest of the session.
      const interval = setInterval(() => {
        client
          .get(`/stories/${story.id}/viewers`)
          .then((res) => {
            setViewerCount(res.data?.data?.viewerCount || 0);
            setViewers(res.data?.data?.viewers || []);
          })
          .catch(() => {});
      }, 8000);
      return () => clearInterval(interval);
    }

    function onViewed(payload) {
      if (String(payload.storyId) !== String(story.id)) return;
      setViewerCount(payload.viewerCount);
      setViewers((prev) => [
        { ...payload.viewer, viewedAt: payload.viewedAt },
        ...prev.filter((v) => v.id !== payload.viewer.id),
      ]);
    }
    socket.on('story:viewed', onViewed);
    return () => socket.off('story:viewed', onViewed);
  }, [story.id, isOwn]);

  useEffect(() => {
    if (!isOwn) return;
    let cancelled = false;
    client
      .get(`/stories/${story.id}/viewers`)
      .then((res) => {
        if (cancelled) return;
        setViewerCount(res.data?.data?.viewerCount || 0);
        setViewers(res.data?.data?.viewers || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [story.id, isOwn]);

   // Keeps the "Posted … / Expires in …" label ticking for everyone.
  const [, forceMetaTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceMetaTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (confirmDelete) return;
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';

      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (typing) return; // let the input handle its own arrow keys

      if (e.key === 'ArrowRight') setIndex((i) => Math.min(group.items.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [group.items.length, onClose, confirmDelete]);

  async function handleDelete() {
    setConfirmDelete(true);
  }

  async function confirmDeleteStory() {
    if (deleting) return;
    try {
      setDeleting(true);
      await client.delete(`/stories/${story.id}`);
      setConfirmDelete(false);
      onDeleted?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to delete story');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSendReply() {
    const text = replyText.trim();
    if (!text || sendingReply) return;
    try {
      setSendingReply(true);

      const owner = users.find((u) => String(u.id) === String(group.user?.id));
      const ownerKeys = (owner?.publicKeys || []).filter(Boolean);
      if (!ownerKeys.length) {
        throw new Error("Can't reply — missing this user's encryption keys");
      }

      const selfKeySet = getCurrentKeySet(currentUserId);
      const selfKeys = selfKeySet.map((k) => k.publicKey).filter(Boolean);
      if (!selfKeys.length) {
        throw new Error('Import your encryption keys before replying');
      }

      const payload = JSON.stringify({
        type: 'story_reply',
        storyId: story.id,
        mediaType: story.mediaType,
        caption: story.caption || null,
        text,
      });

      const forRecipient = sealMessage(payload, pickRandom(ownerKeys));
      const forSender = sealMessage(payload, pickRandom(selfKeys));

      await client.post('/messages', {
        to: String(group.user?.id),
        forRecipient,
        forSender,
        replyToStory: story.id,
      });

      setReplyText('');
      if (replyInputRef.current) replyInputRef.current.style.height = 'auto';
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  }

  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }


  function handleReplyKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  }

  async function sendStoryReplyMedia(file, { plainBytes, mediaKind = 'file', gifUrl } = {}) {
    if (sendingReply) return;
    try {
      setSendingReply(true);

      const owner = users.find((u) => String(u.id) === String(group.user?.id));
      const ownerKeys = (owner?.publicKeys || []).filter(Boolean);
      if (!ownerKeys.length) {
        throw new Error("Can't reply — missing this user's encryption keys");
      }
      const selfKeySet = getCurrentKeySet(currentUserId);
      const selfKeys = selfKeySet.map((k) => k.publicKey).filter(Boolean);
      if (!selfKeys.length) {
        throw new Error('Import your encryption keys before replying');
      }

      const recipientPublicKey = pickRandom(ownerKeys);
      const myPublicKey = pickRandom(selfKeys);

      let attachmentId;

      if (file) {
        const fileBytes = plainBytes || new Uint8Array(await file.arrayBuffer());
        const forRecipientFile = sealBytes(fileBytes, recipientPublicKey);
        const forSenderFile = sealBytes(fileBytes, myPublicKey);
        const mimeType = file.type || 'application/octet-stream';
        const recipientBlob = new Blob([forRecipientFile.cipherBytes], { type: mimeType });
        const senderBlob = new Blob([forSenderFile.cipherBytes], { type: mimeType });

        const initRes = await client.post('/attachments/init', {
          recipientId: String(group.user?.id),
          filename: file.name,
          mimetype: mimeType,
          size: recipientBlob.size,
          nonce: forRecipientFile.nonce,
          ephemeralPublicKey: forRecipientFile.ephemeralPublicKey,
          targetPublicKey: forRecipientFile.targetPublicKey,
          forSenderNonce: forSenderFile.nonce,
          forSenderEphemeralPublicKey: forSenderFile.ephemeralPublicKey,
          forSenderTargetPublicKey: forSenderFile.targetPublicKey,
        });
        const { pendingUploadId, sender } = initRes.data.data;

        async function putCiphertext(blob, filename, slot) {
          const formData = new FormData();
          formData.append('file', blob, filename);
          await client.put(`/attachments/pending/${pendingUploadId}/bytes?slot=${slot}`, formData);
          return undefined;
        }

        const recipientDirectUploadId = await putCiphertext(recipientBlob, file.name, 'recipient');
        const senderDirectUploadId = sender
          ? await putCiphertext(senderBlob, file.name, 'sender')
          : undefined;

        const finalizeRes = await client.post('/attachments/finalize', {
          pendingUploadId,
          recipientDirectUploadId,
          senderDirectUploadId,
        });
        attachmentId = finalizeRes.data.data.id;
      }

      const payload = JSON.stringify({
        type: 'story_reply',
        storyId: story.id,
        mediaType: story.mediaType,
        caption: story.caption || null,
        text: '',
        replyMediaKind: mediaKind,
       
      });

      const forRecipient = sealMessage(payload, recipientPublicKey);
      const forSender = sealMessage(payload, myPublicKey);

      const body = {
        to: String(group.user?.id),
        forRecipient,
        forSender,
        replyToStory: story.id,
      };
      if (attachmentId) body.attachmentId = attachmentId;

      await client.post('/messages', body);
      setGifPickerOpen(false);
      setGifQuery('');
      setGifResults([]);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  }

  function handleReplyFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const kind = file.type.startsWith('video/')
      ? 'video'
      : file.type.startsWith('audio/')
        ? 'audio'
        : 'image';
    sendStoryReplyMedia(file, { mediaKind: kind });
  }

  function clearReplyRecordingResources() {
    if (replyRecordTimerRef.current) {
      clearInterval(replyRecordTimerRef.current);
      replyRecordTimerRef.current = null;
    }
    if (replyMediaStreamRef.current) {
      replyMediaStreamRef.current.getTracks().forEach((t) => t.stop());
      replyMediaStreamRef.current = null;
    }
    replyMediaRecorderRef.current = null;
    replyRecordChunksRef.current = [];
    setReplyRecordSeconds(0);
    setReplyRecording(false);
  }

  async function startReplyVoiceRecording() {
    if (replyRecording || sendingReply) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError?.('Voice notes are not supported in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      replyMediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      replyMediaRecorderRef.current = recorder;
      replyRecordChunksRef.current = [];
      replyRecordStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) replyRecordChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        clearReplyRecordingResources();
        onError?.('Voice recording failed');
      };
      recorder.onstop = async () => {
        const chunks = replyRecordChunksRef.current.slice();
        const type = (recorder.mimeType || 'audio/webm').split(';')[0];
        clearReplyRecordingResources();
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: type || 'audio/webm' });
        if (blob.size < 256) return;
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `story-reply-voice-${Date.now()}.${ext}`, {
          type: type || 'audio/webm',
        });
        const plainBytes = new Uint8Array(await blob.arrayBuffer());
        sendStoryReplyMedia(file, { plainBytes, mediaKind: 'voice' });
      };

      recorder.start(200);
      setReplyRecording(true);
      setReplyRecordSeconds(0);
      replyRecordTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - replyRecordStartedAtRef.current) / 1000);
        setReplyRecordSeconds(elapsed);
        if (elapsed >= 60) stopReplyVoiceRecording();
      }, 200);
    } catch {
      clearReplyRecordingResources();
      onError?.('Microphone permission is required for voice notes');
    }
  }

  function stopReplyVoiceRecording() {
    const recorder = replyMediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      clearReplyRecordingResources();
      return;
    }
    recorder.stop();
  }

  useEffect(() => {
    return () => {
      if (replyRecordTimerRef.current) clearInterval(replyRecordTimerRef.current);
      if (replyMediaStreamRef.current) {
        replyMediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function searchGifs(q) {
    setGifLoading(true);
    try {
      const { data } = await client.get('/gifs/search', { params: { q } });
      setGifResults(data.data || []);
    } catch {
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  }

  useEffect(() => {
    if (!gifPickerOpen) return undefined;
    const q = gifQuery.trim() || 'reaction';
    const timer = setTimeout(() => searchGifs(q), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gifPickerOpen, gifQuery]);

  async function handleReact(emoji) {
    if (reacting) return;
    try {
      setReacting(true);
      setReactionPickerOpen(false);

      const owner = users.find((u) => String(u.id) === String(group.user?.id));
      const ownerKeys = (owner?.publicKeys || []).filter(Boolean);
      if (!ownerKeys.length) {
        throw new Error("Can't react — missing this user's encryption keys");
      }

      const selfKeySet = getCurrentKeySet(currentUserId);
      const selfKeys = selfKeySet.map((k) => k.publicKey).filter(Boolean);
      if (!selfKeys.length) {
        throw new Error('Import your encryption keys before reacting');
      }

      const payload = JSON.stringify({
        type: 'story_reaction',
        storyId: story.id,
        mediaType: story.mediaType,
        emoji,
      });

      const forRecipient = sealMessage(payload, pickRandom(ownerKeys));
      const forSender = sealMessage(payload, pickRandom(selfKeys));

      await client.post('/messages', {
        to: String(group.user?.id),
        forRecipient,
        forSender,
        replyToStory: story.id,
      });

      setBurst(emoji);
      setTimeout(() => setBurst(null), 700);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to react');
    } finally {
      setReacting(false);
    }
  }

  const emojiResults = useMemo(
    () => (emojiQuery.trim() ? searchEmojis(emojiQuery, 60) : COMPOSER_EMOJIS.slice(0, 60)),
    [emojiQuery]
  );
  const reactionResults = useMemo(
    () => (reactionQuery.trim() ? searchEmojis(reactionQuery, 60) : COMPOSER_EMOJIS.slice(0, 60)),
    [reactionQuery]
  );
  function insertEmoji(emoji) {
    setReplyText((t) => t + emoji);
  }

  // Single tap left/right navigates; a second tap within the window is
  // treated as a double-tap "like" instead, so the pending nav is cancelled.
  const mediaClickTimerRef = useRef(null);

  function handleMediaClick(e) {
    if (mediaClickTimerRef.current) {
      clearTimeout(mediaClickTimerRef.current);
      mediaClickTimerRef.current = null;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const tappedRight = e.clientX - rect.left > rect.width / 2;

    mediaClickTimerRef.current = setTimeout(() => {
      mediaClickTimerRef.current = null;
      if (tappedRight) {
        if (index < group.items.length - 1) {
          setIndex((i) => i + 1);
        } else {
          onClose(); // tapped right on the last story — go outside
        }
      } else if (index > 0) {
        setIndex((i) => i - 1);
      }
      // tapping left on the first story is a no-op
    }, 250);
  }

  function handleMediaDoubleClick() {
    if (mediaClickTimerRef.current) {
      clearTimeout(mediaClickTimerRef.current);
      mediaClickTimerRef.current = null;
    }
    if (!isOwn) handleReact('❤️');
  }

  useEffect(() => {
    return () => {
      if (mediaClickTimerRef.current) clearTimeout(mediaClickTimerRef.current);
    };
  }, []);

  return createPortal(
    <div className="story-viewer-overlay" onClick={onClose}>
      <div className="story-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="story-viewer-top">
           <div className="story-viewer-user">
            <UserAvatar
              userId={group.user?.id}
              name={group.user?.username}
              hasAvatar={group.user?.hasAvatar}
              size="sm"
            />
            <div className="story-viewer-user-text">
              <span>{group.user?.username}</span>
              <span className="story-viewer-user-meta">
                {formatElapsed(story.createdAt)}
                {isOwn ? ` · ${formatRemaining(story.expiresAt)}` : ''}
              </span>
            </div>
            {story.sealed ? <span className="story-sealed-badge">Sealed X5</span> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="story-viewer-progress">
          {group.items.map((s, i) => (
            <span key={s.id} className={i === index ? 'on' : ''} />
          ))}
        </div>
               <div
          className="story-viewer-media"
          onClick={handleMediaClick}
          onDoubleClick={handleMediaDoubleClick}
        >
          {blockedReason && (
            <div className="story-decrypt-error" role="alert">
              <p className="story-decrypt-error-title">Can’t open this story</p>
              <p>{blockedReason}</p>
            </div>
          )}
          {!blockedReason && !mediaUrl && (
            <div className="story-media-loading" aria-live="polite">
              <div className="skeleton skeleton-line story-media-loading-bar" />
              <p className="empty-hint">
                {loadPhase === 'decrypt'
                  ? 'Decrypting…'
                  : downloadPct != null
                    ? `Downloading… ${downloadPct}%`
                    : 'Loading status…'}
              </p>
            </div>
          )}
          {mediaUrl && story.mediaType === 'image' && <img src={mediaUrl} alt="" />}
          {mediaUrl && story.mediaType === 'video' && <video src={mediaUrl} autoPlay controls />}
          {mediaUrl && story.mediaType === 'audio' && <audio src={mediaUrl} autoPlay controls />}
          {burst && <span className="story-reaction-burst">{burst}</span>}
        </div>
        {story.caption && <p className="story-caption">{story.caption}</p>}
        <div className="story-viewer-actions">
            {isOwn && (
              <div className="story-viewer-actions-left">
                <button
                  type="button"
                  className="story-viewers-btn"
                  onClick={() => setViewersOpen(true)}
                >
                  <Eye size={16} strokeWidth={2} />
                  <span>{viewerCount}</span>
                </button>
                <button type="button" className="story-delete-btn" onClick={handleDelete}>
                  Delete
                </button>
              </div>
            )}
          </div>

       {isOwn && viewersOpen && (
          <StoryViewersSheet
            viewerCount={viewerCount}
            viewers={viewers}
            onClose={() => setViewersOpen(false)}
          />
        )}
       {!isOwn && story.allowReplies !== false && (
          <form
            className="story-reply-bar"
            onSubmit={(e) => {
              e.preventDefault();
              handleSendReply();
            }}
          >
            <input
              ref={replyFileInputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              hidden
              onChange={handleReplyFileChange}
            />
            <div className="story-reply-row-main">
              <button
                type="button"
                className="story-icon-btn"
                aria-label="Attach media"
                disabled={sendingReply || replyRecording}
                onClick={() => replyFileInputRef.current?.click()}
              >
                <Paperclip size={18} strokeWidth={2} />
              </button>

              <div className="story-reply-input-wrap">
                <textarea
                  ref={replyInputRef}
                  rows={1}
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value);
                    autoGrow(e.target);
                  }}
                  onKeyDown={handleReplyKeyDown}
                  placeholder={
                    replyRecording
                      ? `Recording ${String(Math.floor(replyRecordSeconds / 60)).padStart(2, '0')}:${String(replyRecordSeconds % 60).padStart(2, '0')}…`
                      : `Reply to ${group.user?.username}…`
                  }
                  disabled={sendingReply || replyRecording}
                />
                <button
                  type="button"
                  className={`story-emoji-btn ${emojiPickerOpen ? 'open' : ''}`}
                  aria-label={emojiPickerOpen ? 'Close emoji picker' : 'Add emoji to message'}
                  onClick={() => {
                    setEmojiPickerOpen((v) => !v);
                    setReactionPickerOpen(false);
                    setGifPickerOpen(false);
                  }}
                >
                  {emojiPickerOpen ? <X size={17} strokeWidth={2.2} /> : <Smile size={17} strokeWidth={2} />}
                </button>
              </div>

              {replyText.trim() ? (
                <button
                  type="submit"
                  disabled={sendingReply}
                  aria-label="Send reply"
                  className="story-reply-send ready"
                >
                  {sendingReply ? <span className="story-reply-spinner" /> : <Send size={16} strokeWidth={2.2} />}
                </button>
              ) : (
                <button
                  type="button"
                  className={`story-icon-btn ${replyRecording ? 'recording' : ''}`}
                  aria-label={replyRecording ? 'Stop recording' : 'Record a voice reply'}
                  disabled={sendingReply}
                  onClick={replyRecording ? stopReplyVoiceRecording : startReplyVoiceRecording}
                >
                  {replyRecording ? <Square size={17} strokeWidth={2.2} /> : <Mic size={18} strokeWidth={2} />}
                </button>
              )}

              <button
                type="button"
                className={`story-icon-btn ${reactionPickerOpen ? 'open' : ''}`}
                aria-label={reactionPickerOpen ? 'Close reactions' : 'Send a reaction'}
                disabled={reacting || replyRecording}
                onClick={() => {
                  setReactionPickerOpen((v) => !v);
                  setEmojiPickerOpen(false);
                  setGifPickerOpen(false);
                }}
              >
                {reactionPickerOpen ? <X size={17} strokeWidth={2.2} /> : '❤️'}
              </button>

              <button
                type="button"
                className={`story-icon-btn story-gif-btn ${gifPickerOpen ? 'open' : ''}`}
                aria-label={gifPickerOpen ? 'Close GIF picker' : 'Send a GIF'}
                disabled={sendingReply || replyRecording}
                onClick={() => {
                  setGifPickerOpen((v) => !v);
                  setEmojiPickerOpen(false);
                  setReactionPickerOpen(false);
                }}
              >
                {gifPickerOpen ? <X size={17} strokeWidth={2.2} /> : 'GIF'}
              </button>
            </div>

            {emojiPickerOpen && (
              <div className="story-emoji-picker anchored-left">
                <div className="story-reaction-picker-header">
                  <input
                    type="text"
                    value={emojiQuery}
                    onChange={(e) => setEmojiQuery(e.target.value)}
                    placeholder="Search emoji"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="story-reaction-picker-close"
                    aria-label="Close"
                    onClick={() => setEmojiPickerOpen(false)}
                  >
                    <X size={15} strokeWidth={2.2} />
                  </button>
                </div>
                <div className="story-reaction-picker-grid">
                  {emojiResults.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {reactionPickerOpen && (
              <div className="story-reaction-picker anchored-right">
                <div className="story-reaction-picker-header">
                  <input
                    type="text"
                    value={reactionQuery}
                    onChange={(e) => setReactionQuery(e.target.value)}
                    placeholder="Search emoji"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="story-reaction-picker-close"
                    aria-label="Close"
                    onClick={() => setReactionPickerOpen(false)}
                  >
                    <X size={15} strokeWidth={2.2} />
                  </button>
                </div>
                <div className="story-reaction-picker-grid">
                  {reactionResults.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => handleReact(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {gifPickerOpen && (
              <div className="story-reaction-picker anchored-right" style={{ width: 'min(320px, calc(100vw - 32px))' }}>
                <div className="story-reaction-picker-header">
                  <input
                    type="text"
                    value={gifQuery}
                    onChange={(e) => setGifQuery(e.target.value)}
                    placeholder="Search GIFs"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="story-reaction-picker-close"
                    aria-label="Close"
                    onClick={() => setGifPickerOpen(false)}
                  >
                    <X size={15} strokeWidth={2.2} />
                  </button>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 6,
                    maxHeight: 220,
                    overflow: 'auto',
                  }}
                >
                  {gifLoading && <p className="empty-hint" style={{ gridColumn: '1 / -1' }}>Searching…</p>}
                  {!gifLoading && gifResults.length === 0 && (
                    <p className="empty-hint" style={{ gridColumn: '1 / -1' }}>No GIFs found</p>
                  )}
                  {gifResults.map((gif) => (
                    <button
                      key={gif.id}
                      type="button"
                      style={{ padding: 0, border: 0, borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}
                      disabled={sendingReply}
                      onClick={async () => {
                      try {
                        const resp = await fetch(gif.url);
                        if (!resp.ok) throw new Error('Could not download GIF');
                        const blob = await resp.blob();
                        const file = new File([blob], `gif-${Date.now()}.gif`, {
                          type: blob.type || 'image/gif',
                        });
                        await sendStoryReplyMedia(file, { mediaKind: 'gif' });
                      } catch (err) {
                        onError?.(err.message || 'Failed to send GIF — try again');
                      }
                    }}
                    >
                      <img
                        src={gif.previewUrl}
                        alt=""
                        style={{ width: '100%', height: 70, objectFit: 'cover', display: 'block' }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this story?"
        message="This story will be removed for everyone who can see it. This can’t be undone."
        confirmLabel="Delete story"
        cancelLabel="Keep story"
        danger
        busy={deleting}
        onCancel={() => {
          if (!deleting) setConfirmDelete(false);
        }}
        onConfirm={confirmDeleteStory}
      />
    </div>,
    document.body,
  );
}

function StoryComposer({ file, previewUrl, onCancel, onConfirm, uploading }) {
  const [preset, setPreset] = useState(DEFAULT_TTL_MS);
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState(24);
  const [customUnit, setCustomUnit] = useState('hours');
  const [allowReplies, setAllowReplies] = useState(true);
  const imagePreviewRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const audioPreviewRef = useRef(null);

  const unitMultiplier = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };

  useEffect(() => {
    let safePreviewUrl = '';
    try {
      const parsed = new URL(previewUrl);
      if (parsed.protocol === 'blob:') safePreviewUrl = parsed.href;
    } catch {
      // Leave media sources unset for malformed preview URLs.
    }

    const previewElements = [
      imagePreviewRef.current,
      videoPreviewRef.current,
      audioPreviewRef.current,
    ].filter(Boolean);

    for (const element of previewElements) {
      if (safePreviewUrl) element.src = safePreviewUrl;
      else element.removeAttribute('src');
    }

    return () => {
      for (const element of previewElements) element.removeAttribute('src');
    };
  }, [previewUrl]);

  function computeTtlMs() {
    if (customMode) {
      const raw = Number(customValue) || 0;
      const ms = raw * (unitMultiplier[customUnit] || unitMultiplier.hours);
      return Math.min(Math.max(ms, MIN_TTL_MS), MAX_TTL_MS);
    }
    return preset;
  }

  return (
    <div className="story-composer-overlay" onClick={onCancel}>
      <div className="story-composer" onClick={(e) => e.stopPropagation()}>
        <div className="story-composer-top">
          <span>New story</span>
          <button type="button" onClick={onCancel} aria-label="Cancel">
            ×
          </button>
        </div>

        <div className="story-composer-preview">
          {file.type.startsWith('image/') && <img ref={imagePreviewRef} alt="" />}
          {file.type.startsWith('video/') && <video ref={videoPreviewRef} controls />}
          {file.type.startsWith('audio/') && <audio ref={audioPreviewRef} controls />}
        </div>

        <div className="story-composer-ttl">
          <p className="story-composer-ttl-label">Visible for</p>
          <div className="story-composer-ttl-presets" role="group" aria-label="Story duration">
            {TTL_PRESETS.map((p) => (
              <button
                key={p.ms}
                type="button"
                className={`story-ttl-preset ${!customMode && preset === p.ms ? 'active' : ''}`}
                disabled={uploading}
                onClick={() => {
                  setCustomMode(false);
                  setPreset(p.ms);
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className={`story-ttl-preset ${customMode ? 'active' : ''}`}
              disabled={uploading}
              onClick={() => setCustomMode(true)}
            >
              Custom…
            </button>
          </div>

          {customMode && (
            <div className="story-composer-custom-row">
              <input
                type="number"
                min="1"
                value={customValue}
                disabled={uploading}
                onChange={(e) => setCustomValue(e.target.value)}
                aria-label="Custom duration value"
              />
              <select
                value={customUnit}
                disabled={uploading}
                onChange={(e) => setCustomUnit(e.target.value)}
                aria-label="Custom duration unit"
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          )}
          <p className="story-composer-ttl-hint">
            Min 15 minutes · max 7 days. Media is sealed before upload.
          </p>
        </div>

        <label className="story-composer-ttl" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={allowReplies}
            disabled={uploading}
            onChange={(e) => setAllowReplies(e.target.checked)}
          />
          <span className="story-composer-ttl-label" style={{ margin: 0 }}>
            Allow replies to this story
          </span>
        </label>

        <div className="story-composer-actions">
          <button type="button" className="story-composer-cancel" onClick={onCancel} disabled={uploading}>
            Cancel
          </button>
          <button
            type="button"
            className="story-composer-post"
            disabled={uploading}
            onClick={() => onConfirm(computeTtlMs(), allowReplies)}
          >
            {uploading ? 'Encrypting & posting…' : 'Post story'}
          </button>
        </div>
      </div>
    </div>
  );
}