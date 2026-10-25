import { useState, useRef, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { getDisplayName } from '../utils/getDisplayName.js';
import { conversationKeyForGroup, conversationKeyForUser } from '../utils/readState.js';
import {
  getStarredEntries,
  getStarredIds,
  toggleStarredMessage,
  togglePinnedMessage,
  rememberAutoImportantRemoval,
  clearAutoImportantRemoval,
  getAutoImportantRemovedIds,
} from '../utils/messageExtras.js';
import { getAutomaticImportantSource } from '../utils/importantMessages.js';

/**
 * Custom hook managing pinned messages, starred messages, and important messages.
 */
export default function usePinnedAndStarredMessages({
  user,
  users = [],
  groups = [],
  selected,
  selectedRef,
  messages = [],
  hasLocalKeyring = false,
  showToast,
  i18n,
  decorate,
  setGroups,
  setSelected,
  setExtrasTick,
} = {}) {
  const [starredIds, setStarredIds] = useState(() => getStarredIds(user?.id));
  const [importantEntries, setImportantEntries] = useState([]);
  const [importantLoading, setImportantLoading] = useState(false);
  const [showStarredMessages, setShowStarredMessages] = useState(false);
  const [starredScope, setStarredScope] = useState('all'); // 'all' | 'chat'
  const [pinnedIds, setPinnedIds] = useState([]);
  const importantEntriesRef = useRef([]);

  // Keep latest decorate and directory collections in refs to avoid
  // triggering re-fetches or breaking callback identity.
  const importantDecorateRef = useRef(decorate);
  importantDecorateRef.current = decorate;
  const importantUsersRef = useRef(users);
  importantUsersRef.current = users;
  const importantGroupsRef = useRef(groups);
  importantGroupsRef.current = groups;

  const loadImportantMessages = useCallback(async () => {
    if (!user?.id) return;
    setImportantLoading(true);
    try {
      const { data } = await client.get('/messages/important');
      const markedAtById = new Map(
        (data?.data?.entries || []).map((entry) => [String(entry.messageId), entry.markedAt]),
      );
      const directoryUsers = importantUsersRef.current;
      const directoryGroups = importantGroupsRef.current;
      const next = (data?.data?.messages || []).map((raw) => {
        const message = importantDecorateRef.current ? importantDecorateRef.current(raw) : raw;
        const messageId = String(message.id || message._id);
        const groupId = raw.group ? String(raw.group) : null;
        const group = groupId
          ? directoryGroups.find((candidate) => String(candidate.id) === groupId)
          : null;
        const peerId = raw.group
          ? groupId
          : String(raw.from) === String(user.id) ? raw.to : raw.from;
        const peer = peerId
          ? directoryUsers.find((candidate) => String(candidate.id) === String(peerId))
          : null;
        const type = groupId ? 'group' : 'dm';
        const title = group?.name || getDisplayName(peer, i18n?.language) || 'Chat';
        return {
          ...message,
          id: messageId,
          type,
          conversationId: groupId || peerId,
          conversationKey: groupId ? conversationKeyForGroup(groupId) : conversationKeyForUser(peerId),
          title,
          from: raw.from,
          createdAt: raw.createdAt,
          hasAttachment: Boolean(message.attachment),
          attachmentFilename: message.attachment?.filename || null,
          important: true,
          isImportant: true,
          importantAt: markedAtById.get(messageId) || null,
        };
      });
      setImportantEntries(next);
    } catch (err) {
      setImportantEntries([]);
      const status = err.response?.status;
      const msg = err.response?.data?.error || '';
      if (status && status !== 400 && status !== 404 && msg !== 'Invalid user id') {
        showToast?.(msg || "Couldn't load Important messages", 'error');
      }
    } finally {
      setImportantLoading(false);
    }
  }, [i18n?.language, showToast, user?.id]);

  useEffect(() => {
    if (hasLocalKeyring) void loadImportantMessages();
  }, [hasLocalKeyring, loadImportantMessages]);

  useEffect(() => {
    importantEntriesRef.current = importantEntries;
  }, [importantEntries]);

  const markMessageImportantIfNeeded = useCallback(async (rawMessage) => {
    if (!rawMessage || !user?.id) return;
    const messageId = String(rawMessage.id || rawMessage._id || '');
    if (!messageId) return;
    const alreadyImportant = importantEntriesRef.current.some((entry) => String(entry.id || entry._id) === messageId);
    if (alreadyImportant) return;
    const autoSource = getAutomaticImportantSource(rawMessage);
    if (!autoSource) return;
    if (getAutoImportantRemovedIds(user.id).includes(messageId)) return;

    try {
      await client.post(`/messages/${messageId}/important`);
      setImportantEntries((current) => [{
        ...rawMessage,
        id: messageId,
        title: rawMessage.title || 'Chat',
        conversationId: rawMessage.conversationId || rawMessage.group || rawMessage.to || rawMessage.from,
        type: rawMessage.group ? 'group' : 'dm',
        hasAttachment: Boolean(rawMessage.attachment || rawMessage.attachments?.length),
        attachmentFilename: rawMessage.attachment?.filename || rawMessage.attachments?.[0]?.filename || null,
        text: rawMessage.text || rawMessage.content || null,
        important: true,
        isImportant: true,
        importantAt: new Date().toISOString(),
        importantSource: autoSource,
      }, ...current]);
    } catch (err) {
      // Ignore duplicate or noisy auto-save failures
    }
  }, [user?.id]);

  const handleStarMessage = useCallback((messageId) => {
    if (!messageId || !selected) return;
    const msg = messages.find((m) => String(m.id || m._id) === String(messageId));
    const nextIds = toggleStarredMessage(
      user?.id,
      msg || { id: messageId },
      { key: selected.key, type: selected.type, id: selected.id, title: selected.title },
    );
    setStarredIds(nextIds);
    setExtrasTick?.((n) => n + 1);
  }, [messages, selected, setExtrasTick, user?.id]);

  const handleUnstarMessage = useCallback((id) => {
    const nextIds = toggleStarredMessage(user?.id, { id }, null);
    setStarredIds(nextIds);
    setExtrasTick?.((n) => n + 1);
  }, [setExtrasTick, user?.id]);

  const handleImportantMessage = useCallback(async (messageOrId) => {
    const messageId = String(messageOrId?.id || messageOrId?._id || messageOrId || '');
    if (!messageId) return;
    const message = typeof messageOrId === 'object'
      ? messageOrId
      : messages.find((candidate) => String(candidate.id || candidate._id) === messageId);
    const previous = importantEntries;
    const existing = previous.some((entry) => String(entry.id || entry._id) === messageId);

    if (existing) {
      const wasAutomatic = Boolean(getAutomaticImportantSource(message || previous.find((entry) => String(entry.id || entry._id) === messageId) || {}));
      if (wasAutomatic) {
        rememberAutoImportantRemoval(user?.id, messageId);
      }
      setImportantEntries((current) => current.filter((entry) => String(entry.id || entry._id) !== messageId));
      try {
        await client.delete(`/messages/${messageId}/important`);
        showToast?.('Removed from Important messages', 'success');
      } catch (err) {
        setImportantEntries(previous);
        showToast?.(err.response?.data?.error || "Couldn't remove message. Try again.", 'error');
      }
      return;
    }

    clearAutoImportantRemoval(user?.id, messageId);
    const rawConversation = selected;
    const optimistic = {
      ...message,
      id: messageId,
      type: rawConversation?.type || (message?.group ? 'group' : 'dm'),
      conversationId: rawConversation?.id || (message?.group ? message.group : message?.from),
      conversationKey: rawConversation?.key || null,
      title: rawConversation?.title || 'Chat',
      isImportant: true,
      important: true,
      importantAt: new Date().toISOString(),
      hasAttachment: Boolean(message?.attachment),
      attachmentFilename: message?.attachment?.filename || null,
      importantSource: getAutomaticImportantSource(message || {}),
    };
    setImportantEntries((current) => [optimistic, ...current]);
    try {
      await client.post(`/messages/${messageId}/important`);
      showToast?.('Message saved to Important messages', 'success');
    } catch (err) {
      setImportantEntries(previous);
      showToast?.(err.response?.data?.error || "Couldn't save message. Try again.", 'error');
    }
  }, [importantEntries, messages, selected, showToast, user?.id]);

  const handlePinMessage = useCallback(async (messageId) => {
    if (!selected?.key) return;
    if (selected.type === "group") {
      const pinned = (selected.group?.pinnedMessageIds || []).map(String);
      const isPinned = pinned.includes(String(messageId));
      try {
        const { data } = isPinned
          ? await client.delete(`/groups/${selected.id}/pins/${messageId}`)
          : await client.post(`/groups/${selected.id}/pins/${messageId}`);
        const group = data.data;
        setGroups?.((prev) =>
          prev.map((g) => (String(g.id) === String(group.id) ? group : g)),
        );
        setSelected?.((prev) =>
          prev ? { ...prev, group, title: group.name || prev.title } : prev,
        );
        setPinnedIds((group.pinnedMessageIds || []).map(String));
        setExtrasTick?.((n) => n + 1);
      } catch (err) {
        showToast?.(err.response?.data?.error || "Failed to update pin", "error");
      }
      return;
    }
    setPinnedIds(togglePinnedMessage(user?.id, selected.key, messageId));
    setExtrasTick?.((n) => n + 1);
  }, [selected, setExtrasTick, setGroups, setSelected, showToast, user?.id]);

  // Compute starred & important entries inline at render time to guarantee
  // fresh localStorage reads and immediate modal updates upon star/unstar.
  const starredAndImportantEntries =
    starredScope === 'chat' && selected
      ? [...importantEntries, ...getStarredEntries(user?.id)].filter((e) => e.conversationKey === selected.key)
      : [...importantEntries, ...getStarredEntries(user?.id)];

  return {
    pinnedIds,
    setPinnedIds,
    starredIds,
    setStarredIds,
    showStarredMessages,
    setShowStarredMessages,
    starredScope,
    setStarredScope,
    importantEntries,
    setImportantEntries,
    importantLoading,
    setImportantLoading,
    loadImportantMessages,
    markMessageImportantIfNeeded,
    handleStarMessage,
    handleUnstarMessage,
    handleImportantMessage,
    handlePinMessage,
    starredAndImportantEntries,
  };
}
