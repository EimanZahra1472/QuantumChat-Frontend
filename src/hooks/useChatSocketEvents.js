import { useEffect } from 'react';
import activityStore from '../utils/activityStore.js';
import client from '../api/client.js';
import { isChatMuted } from '../utils/chatPrefs.js';
import { conversationKeyForGroup, conversationKeyForUser } from '../utils/readState.js';
import {
  shouldNotify,
  playNotificationSound,
  showNotificationPopup,
} from '../utils/notificationDispatch.js';
import { getSocket } from '../api/socket.js';

/** Whether a message belongs to a Clear-chat scope bucket. */
function messageMatchesClearScope(message, scope) {
  if (scope === "all") return true;
  const category = message?.mediaCategory;
  const hasAttachment = Boolean(
    message?.attachment &&
      (typeof message.attachment === "object"
        ? message.attachment.id || message.attachment._id
        : message.attachment),
  );
  if (scope === "text") return !category && !hasAttachment;
  return category === scope;
}

/**
 * Custom hook to register and manage socket event listeners for chat state
 * (presence, typing, receipts, edits, deletions, reactions, groups, and friendship events).
 */
export default function useChatSocketEvents({
  socket: socketProp,
  hasLocalKeyring,
  user,
  userRef,
  users,
  setUsers,
  groups,
  setGroups,
  groupsRef,
  selectedRef,
  setSelected,
  setMessages,
  messagesRef,
  decorate,
  decorateRef,
  setOnlineUserIds,
  setPeerTyping,
  setGroupTypingUsers,
  typingPeerTimeoutRef,
  stopTyping,
  syncTypingPrivacy,
  setPinnedIds,
  setShowGroupSettings,
  setShowCommandCenter,
  setUnreadNotificationCount,
  setLoadingMessages,
  applyAcceptedFriendship,
  loadDirectory,
  loadFriendRequests,
  loadMyFriends,
  loadFriendDiscover,
  setMyFriends,
  updateSessionUser,
  search,
  showToast,
  notifSettings,
  resolveActivityActor,
  handleSelectConversation,
  handleSearchResult,
  navigate,
  location,
} = {}) {
  useEffect(() => {
    if (!hasLocalKeyring) return;
    const socket = socketProp || getSocket();
    if (!socket) return undefined;

    function isCurrentConversation(raw) {
      const current = selectedRef?.current;
      if (!current) return false;
      if (raw.group) {
        return (
          current.type === "group" && String(current.id) === String(raw.group)
        );
      }
      const otherId = String(raw.from) === String(user?.id) ? raw.to : raw.from;
      return current.type === "dm" && String(current.id) === String(otherId);
    }

    function handleDeleted(payload) {
      const id = String(payload?.id || "");
      if (!id) return;
      setMessages((prev) => prev.filter((m) => String(m.id || m._id) !== id));
    }

    function handleExpired(payload) {
      const id = String(payload?.id || "");
      if (!id) return;
      setMessages((prev) => prev.filter((m) => String(m.id || m._id) !== id));
    }

    function handleReaction(raw) {
      const messageId = String(raw?.id || raw?._id || raw?.messageId || raw?.message?.id || raw?.message?._id || "");
      if (!messageId) return;

      const decorated = decorate(raw);
      const prevMessage = messagesRef?.current?.find(
        (candidate) => String(candidate.id || candidate._id) === messageId,
      );
      const prevReactions = prevMessage?.reactions || [];
      const nextReactions = decorated.reactions || [];
      const changed = nextReactions.find((next) => {
        const prev = prevReactions.find((p) => String(p.user) === String(next.user));
        return !prev || prev.emoji !== next.emoji;
      });

      if (changed) {
        const actorId = changed.user;
        const actor = resolveActivityActor ? resolveActivityActor(actorId) : { actorLabel: "Someone", actorIsCurrentUser: false };
        const groupId = typeof raw?.group === "object" ? raw.group.id || raw.group._id : raw?.group;
        const groupName = typeof raw?.group === "object" ? raw.group.name : groupsRef?.current?.find((candidate) => String(candidate.id || candidate._id) === String(groupId))?.name;
        const originalAuthor = resolveActivityActor ? resolveActivityActor(decorated.from) : { actorLabel: "Someone", actorIsCurrentUser: false };
        activityStore.appendEvent({
          id: `${messageId}:${actorId}:${changed.emoji || "clear"}:${Date.now()}`,
          type: "reaction",
          targetId: messageId,
          messageId,
          actorId,
          actorName: actor.actorLabel,
          actorIsCurrentUser: actor.actorIsCurrentUser,
          emoji: changed.emoji,
          groupId,
          groupName,
          preview: decorated.text,
          originalAuthorLabel: originalAuthor.actorLabel,
          originalAuthorIsCurrentUser: originalAuthor.actorIsCurrentUser,
          reactedByYou: actor.actorIsCurrentUser,
          conversationKey: groupId ? `group:${groupId}` : undefined,
        });

        if (String(actorId) !== String(user?.id)) {
          const convKey = groupId
            ? conversationKeyForGroup(groupId)
            : conversationKeyForUser(String(decorated.from) === String(user?.id) ? decorated.to : decorated.from);
          const muted = isChatMuted(user?.id, convKey);
          if (!muted && shouldNotify(notifSettings, { kind: 'reaction' })) {
            playNotificationSound(notifSettings);
            showNotificationPopup(
              {
                title: 'QuantumChat',
                body: `${actor.actorLabel} reacted ${changed.emoji || ''} to your message`,
                tag: groupId ? `group:${groupId}` : `dm:${[String(user?.id), String(actorId)].sort().join(':')}`,
              },
              notifSettings,
              () =>
                handleSelectConversation?.(
                  groupId ? { key: convKey, type: 'group', id: groupId } : { key: convKey, type: 'dm', id: actorId },
                ),
            );
          }
        }
      }

      if (!isCurrentConversation(raw)) return;
      setMessages((prev) =>
        prev.map((m) => (String(m.id || m._id) === messageId ? decorated : m)),
      );
    }

    function handleEdited(raw) {
      const id = String(raw?.id || raw?._id || "");
      if (!id) return;
      if (!isCurrentConversation(raw)) return;
      setMessages((prev) =>
        prev.map((m) => (String(m.id || m._id) === id ? decorate(raw) : m)),
      );
    }

    function handleViewOnceOpened(raw) {
      const id = String(raw?.id || raw?._id || "");
      if (!id) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => String(m.id || m._id) === id);
        if (idx === -1) return prev;
        const current = prev[idx];
        const decorated = decorate(raw);
        const next = [...prev];
        next[idx] = {
          ...decorated,
          text: decorated.text ?? current.text,
        };
        return next;
      });
    }

    function handleMessageListened(payload = {}) {
      const id = String(payload.messageId || payload.id || "");
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (String(m.id || m._id) === id) {
            const currentListened = m.listenedBy || [];
            const userStr = String(payload.userId || payload.user || "");
            if (userStr && !currentListened.some((e) => String(e.user) === userStr)) {
              return {
                ...m,
                listenedBy: [
                  ...currentListened,
                  { user: userStr, at: payload.listenedAt || new Date().toISOString() },
                ],
              };
            }
            if (payload.listenedBy) {
              return { ...m, listenedBy: payload.listenedBy };
            }
          }
          return m;
        }),
      );
    }

    function handleGroupNew(payload = {}) {
      const group = payload?.group || payload;
      const groupId = group?.id || group?._id || payload?.groupId;
      if (groupId) {
        activityStore.appendEvent({
          id: `new:${groupId}`,
          type: "group",
          targetId: groupId,
          groupId,
          groupName: group?.name || payload?.groupName,
          action: "created",
          actorId: payload?.actorId || payload?.createdBy,
          ...(resolveActivityActor ? resolveActivityActor(payload?.actorId || payload?.createdBy) : {}),
        });
      }
      setGroups((prev) => {
        if (!groupId) return prev;
        if (prev.some((g) => String(g.id || g._id) === String(groupId))) {
          return prev.map((g) =>
            String(g.id || g._id) === String(groupId) ? group : g,
          );
        }
        return [group, ...prev];
      });
    }

    function handleGroupUpdated(payload = {}) {
      const group = payload?.group || payload;
      const groupId = group.id || group._id || payload.groupId;
      if (!groupId) return;
      activityStore.appendEvent({
        id: `updated:${groupId}`,
        type: "group",
        targetId: groupId,
        groupId,
        groupName: group.name || payload.groupName,
        action: "updated",
        actorId: payload.actorId || payload.updatedBy,
        ...(resolveActivityActor ? resolveActivityActor(payload.actorId || payload.updatedBy) : {}),
      });
      setGroups((prev) => {
        if (prev.some((g) => String(g.id) === String(groupId))) {
          return prev.map((g) =>
            String(g.id) === String(groupId) ? group : g,
          );
        }
        return [group, ...prev];
      });
      const current = selectedRef?.current;
      if (
        current?.type === "group" &&
        String(current.id) === String(groupId)
      ) {
        const memberCount = (group.members || []).length;
        const desc = (group.description || "").trim();
        setSelected((prev) =>
          prev
            ? {
                ...prev,
                group,
                title: group.name || prev.title,
                subtitle: desc
                  ? desc.slice(0, 60) + (desc.length > 60 ? "…" : "")
                  : `${memberCount} member${memberCount === 1 ? "" : "s"}`,
              }
            : prev,
        );
        setPinnedIds?.((group.pinnedMessageIds || []).map(String));
      }
    }

    function handleGroupDeleted(payload = {}) {
      const id = payload.id || payload._id || payload.groupId || payload.group?.id || payload.group?._id;
      if (!id) return;
      activityStore.appendEvent({
        id: `deleted:${id}`,
        type: "group",
        targetId: id,
        groupId: id,
        groupName: payload.groupName || payload.group?.name,
        action: "deleted",
        actorId: payload.actorId || payload.deletedBy,
        ...(resolveActivityActor ? resolveActivityActor(payload.actorId || payload.deletedBy) : {}),
      });
      setGroups((prev) => prev.filter((g) => String(g.id) !== String(id)));
      const current = selectedRef?.current;
      if (current?.type === "group" && String(current.id) === String(id)) {
        setSelected(null);
        setMessages([]);
        setShowGroupSettings?.(false);
        setShowCommandCenter?.(false);
        if (location?.pathname !== "/chat") navigate?.("/chat");
      }
    }

    function handlePollUpdate(raw) {
      const id = String(raw?.id || raw?._id || "");
      if (!id) return;
      if (!isCurrentConversation(raw)) return;
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id || m._id) === id
            ? { ...decorate(raw), pollVotes: raw.pollVotes || [] }
            : m,
        ),
      );
    }

    function handleMentionNew(payload = {}) {
      const message = payload?.message || payload;
      const from = message.from || message.senderId || payload.from;
      const messageId = message.id || message._id || message.messageId || payload.messageId;
      const groupId = message.groupId || message.group || payload.groupId;
      const mentionId = messageId || (from && groupId ? `${from}:${groupId}` : null);
      if (mentionId) {
        activityStore.appendEvent({
          id: mentionId,
          type: "mention",
          actorId: from,
          targetId: groupId || message.to || payload.to,
          messageId,
          conversationKey: groupId ? `group:${groupId}` : undefined,
        });
      }

      const isSelf = String(from) === String(user?.id);
      const username = isSelf
        ? user?.username
        : users?.find((u) => String(u.id) === String(from))?.username;
      const groupName = groupId
        ? groups?.find((g) => String(g.id) === String(groupId))?.name
        : null;

      const convKey = groupId ? conversationKeyForGroup(groupId) : null;
      const muted = convKey ? isChatMuted(user?.id, convKey) : false;
      const current = selectedRef?.current;
      const isCurrent =
        groupId && current?.type === "group" && String(current.id) === String(groupId);

      if (isSelf || muted) {
        showToast?.(`${username || "Someone"} mentioned you`);
        return;
      }

      playNotificationSound(notifSettings);
      showNotificationPopup(
        {
          title: groupName || "Group mention",
          body: `${username || "Someone"} mentioned you`,
          tag: groupId ? `group:${groupId}` : undefined,
          data: {
            url: groupId ? `/chat/g/${groupId}` : undefined,
            kind: "group",
          },
        },
        notifSettings,
        () => {
          if (groupId) {
            handleSelectConversation?.({ key: convKey, type: "group", id: groupId });
          }
          if (messageId) handleSearchResult?.(messageId);
        },
      );

      if (!isCurrent) {
        showToast?.(`${username || "Someone"} mentioned you in ${groupName || "a group"}`);
      }
    }

    function handleNotificationNew() {
      setUnreadNotificationCount?.((n) => n + 1);
    }

    function handleTypingStart({ from, groupId } = {}) {
      const current = selectedRef?.current;
      if (!current) return;
      if (
        groupId &&
        current.type === "group" &&
        String(groupId) === String(current.id)
      ) {
        if (String(from) === String(user?.id)) return;
        const activeGroup = groups?.find((g) => String(g.id) === String(current.id)) || current.group;
        let u = users?.find((u) => String(u.id) === String(from));
        if (!u) {
          const member = (activeGroup?.members || []).find(
            (m) => String(m.user?._id || m.user?.id || m.id || m._id) === String(from)
          );
          u = member?.user || member;
        }
        const name = u?.username || "Someone";
        const hasAvatar = u?.hasAvatar || !!u?.avatarPath;
        const userObj = { id: from, username: name, hasAvatar };

        setGroupTypingUsers?.((prev) => {
          const filtered = prev.filter(p => String(p.id) !== String(from));
          return [...filtered, userObj].slice(-5);
        });
        if (typingPeerTimeoutRef?.current) {
          clearTimeout(typingPeerTimeoutRef.current);
        }
        if (typingPeerTimeoutRef) {
          typingPeerTimeoutRef.current = setTimeout(
            () => setGroupTypingUsers?.([]),
            3000,
          );
        }
        return;
      }
      if (current.type !== "dm") return;
      if (String(from) !== String(current.id)) return;
      setPeerTyping?.(true);
      if (typingPeerTimeoutRef?.current) {
        clearTimeout(typingPeerTimeoutRef.current);
      }
      if (typingPeerTimeoutRef) {
        typingPeerTimeoutRef.current = setTimeout(
          () => setPeerTyping?.(false),
          4000,
        );
      }
    }

    function handleTypingStop({ from, groupId } = {}) {
      const current = selectedRef?.current;
      if (!current) return;
      if (
        groupId &&
        current.type === "group" &&
        String(groupId) === String(current.id)
      ) {
        setGroupTypingUsers?.((prev) => prev.filter((u) => String(u.id) !== String(from)));
        return;
      }
      if (current.type !== "dm") return;
      if (String(from) !== String(current.id)) return;
      setPeerTyping?.(false);
    }

    function handlePresenceSnapshot({ onlineUserIds: ids } = {}) {
      setOnlineUserIds?.(new Set((ids || []).map(String)));
    }

    function handlePresenceUpdate({ userId, online, lastLoginAt } = {}) {
      const id = String(userId);
      setOnlineUserIds?.((prev) => {
        const next = new Set(prev);
        if (online) next.add(id);
        else next.delete(id);
        return next;
      });
      if (lastLoginAt) {
        setUsers?.((prev) =>
          prev.map((u) =>
            String(u.id) === id ? { ...u, lastLoginAt } : u,
          ),
        );
        setSelected?.((cur) => {
          if (!cur || cur.type !== "dm" || String(cur.id) !== id) return cur;
          if (cur.peer?.lastLoginAt === lastLoginAt) return cur;
          return {
            ...cur,
            peer: { ...(cur.peer || {}), lastLoginAt },
          };
        });
      }
    }

    function handleMessageStatus(payload) {
      if (!payload) return;
      if (payload.groupId && Array.isArray(payload.messageIds)) {
        const idSet = new Set(payload.messageIds.map(String));
        const rUid = String(payload.userId || "");
        const readAt = payload.readAt ? new Date(payload.readAt).toISOString() : null;
        const deliveredAt = (payload.deliveredAt || payload.readAt)
          ? new Date(payload.deliveredAt || payload.readAt).toISOString()
          : null;
        setMessages((prev) =>
          prev.map((m) => {
            const mid = String(m.id || m._id);
            if (!idSet.has(mid)) return m;
            const existingRead = (m.readBy || []).filter((r) => String(r.user) !== rUid);
            const existingDelivered = (m.deliveredTo || []).filter((d) => String(d.user) !== rUid);
            const nextDelivered = deliveredAt
              ? [...existingDelivered, { user: rUid, at: deliveredAt }]
              : m.deliveredTo || [];
            const nextRead = readAt
              ? [...existingRead, { user: rUid, at: readAt }]
              : m.readBy || [];
            return {
              ...m,
              deliveredTo: nextDelivered,
              readBy: nextRead,
            };
          }),
        );
        return;
      }
      if (payload.bulk && payload.conversationWith) {
        const peer = String(payload.conversationWith);
        setMessages((prev) =>
          prev.map((m) =>
            String(m.to) === peer || String(m.from) === peer
              ? {
                  ...m,
                  deliveredAt: m.deliveredAt || payload.readAt,
                  readAt:
                    String(m.from) === String(user?.id)
                      ? payload.readAt || m.readAt
                      : m.readAt,
                }
              : m,
          ),
        );
        return;
      }
      const id = String(payload.id || "");
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) =>
          String(m.id || m._id) === id
            ? {
                ...m,
                deliveredAt: payload.deliveredAt || m.deliveredAt,
                readAt: payload.readAt || m.readAt,
                _status: undefined,
              }
            : m,
        ),
      );
    }

    function handleFriendRequestNew(payload = {}) {
      const request = payload?.request || payload;
      const requestId = request.id || request._id || request.requestId || payload.requestId;
      const actorId = request.from || request.senderId || request.userId || payload.from;
      const actor = resolveActivityActor ? resolveActivityActor(actorId) : { actorLabel: "Someone", actorIsCurrentUser: false };
      if (requestId || actorId) {
        activityStore.appendEvent({
          id: requestId || `from:${actorId}`,
          type: "friend_request",
          actorId,
          actorName: actor.actorLabel,
          actorIsCurrentUser: actor.actorIsCurrentUser,
          targetId: request.to || request.recipientId || user?.id,
        });
      }
      loadFriendRequests?.();
      showToast?.("New friend request", "info");
    }

    async function handleFriendRequestAccepted(payload = {}) {
      const friend = payload?.friend;
      const requestId = payload?.id || payload?.requestId;
      if (friend) {
        applyAcceptedFriendship?.(friend, requestId);
        const name = friend.displayName || friend.username || "Someone";
        showToast?.(`You're now friends with ${name}`, "success");
      }

      try {
        const { data } = await client.get("/users/me");
        if (data?.data) updateSessionUser?.(data.data);
      } catch {
        // non-fatal
      }

      loadDirectory?.();
      loadFriendRequests?.();
      loadMyFriends?.();
      loadFriendDiscover?.(search);
    }

    async function handleFriendRemoved(payload = {}) {
      const removedBy = payload?.by;
      if (removedBy && userRef?.current) {
        const nextFriends = (userRef.current.friends || [])
          .map(String)
          .filter((id) => id !== String(removedBy));
        updateSessionUser?.({ ...userRef.current, friends: nextFriends });
        setMyFriends?.((prev) =>
          prev.filter((f) => String(f.id || f._id) !== String(removedBy)),
        );
      }
      try {
        const { data } = await client.get("/users/me");
        if (data?.data) updateSessionUser?.(data.data);
      } catch {
        // non-fatal
      }
      loadDirectory?.();
      loadMyFriends?.();
    }

    function handleChatCleared(payload = {}) {
      const current = selectedRef?.current;
      if (!current) return;
      const matchesGroup =
        payload.groupId &&
        current.type === "group" &&
        String(current.id) === String(payload.groupId);
      const matchesDm =
        payload.peerId &&
        current.type === "dm" &&
        String(current.id) === String(payload.peerId);
      if (!matchesGroup && !matchesDm) return;

      const scopes = Array.isArray(payload.scopes) && payload.scopes.length
        ? payload.scopes.map(String)
        : ["all"];
      if (scopes.includes("all")) {
        setMessages([]);
        return;
      }

      const clearedAtMs = payload.clearedAt
        ? new Date(payload.clearedAt).getTime()
        : Date.now();

      setMessages((prev) =>
        prev.filter((m) => {
          const createdMs = new Date(m.createdAt || 0).getTime();
          if (createdMs > clearedAtMs) return true;
          return !scopes.some((scope) => messageMatchesClearScope(m, scope));
        }),
      );
    }

    function handleChatClearUndone(payload = {}) {
      const current = selectedRef?.current;
      if (!current) return;
      const matchesGroup =
        payload.groupId &&
        current.type === "group" &&
        String(current.id) === String(payload.groupId);
      const matchesDm =
        payload.peerId &&
        current.type === "dm" &&
        String(current.id) === String(payload.peerId);
      if (!matchesGroup && !matchesDm) return;

      const endpoint =
        current.type === "group"
          ? `/groups/${current.id}/messages`
          : `/messages/${current.id}`;
      setLoadingMessages?.(true);
      client
        .get(endpoint, { params: { limit: 80, markRead: 0 } })
        .then((res) => {
          setMessages((res.data.data || []).map((raw) => decorateRef?.current ? decorateRef.current(raw) : decorate(raw)));
        })
        .catch(() => {})
        .finally(() => setLoadingMessages?.(false));
    }

    function handleUserStatus(payload = {}) {
      const { userId: statusUserId } = payload;
      if (!statusUserId) return;
      const nextStatus = payload.statusText || "";
      setUsers?.((prev) =>
        prev.map((u) =>
          String(u.id) === String(statusUserId) ? { ...u, statusText: nextStatus } : u,
        ),
      );
      setSelected?.((prev) =>
        prev && prev.type === "dm" && String(prev.id) === String(statusUserId)
          ? {
              ...prev,
              statusText: nextStatus,
              peer: prev.peer ? { ...prev.peer, statusText: nextStatus } : prev.peer,
            }
          : prev,
      );
      if (String(statusUserId) === String(user?.id)) {
        updateSessionUser?.({ ...userRef?.current, statusText: nextStatus });
      }
    }

    function requestPresence() {
      if (socket.connected) {
        socket.emit("presence:request");
        syncTypingPrivacy?.();
      }
    }

    socket.on("message:deleted", handleDeleted);
    socket.on("message:expired", handleExpired);
    socket.on("message:reaction", handleReaction);
    socket.on("message:edited", handleEdited);
    socket.on("message:view-once-opened", handleViewOnceOpened);
    socket.on("message:listened", handleMessageListened);
    socket.on("group:new", handleGroupNew);
    socket.on("group:updated", handleGroupUpdated);
    socket.on("group:deleted", handleGroupDeleted);
    socket.on("mention:new", handleMentionNew);
    socket.on("notification:new", handleNotificationNew);
    socket.on("message:poll", handlePollUpdate);
    socket.on("typing:start", handleTypingStart);
    socket.on("typing:stop", handleTypingStop);
    socket.on("presence:snapshot", handlePresenceSnapshot);
    socket.on("presence:update", handlePresenceUpdate);
    socket.on("message:status", handleMessageStatus);
    socket.on("friend:request:new", handleFriendRequestNew);
    socket.on("friend:request:accepted", handleFriendRequestAccepted);
    socket.on("friend:removed", handleFriendRemoved);
    socket.on("chat:cleared", handleChatCleared);
    socket.on("chat:clear-undone", handleChatClearUndone);
    socket.on("user:status", handleUserStatus);
    socket.on("connect", requestPresence);
    requestPresence();

    return () => {
      socket.off("message:deleted", handleDeleted);
      socket.off("message:expired", handleExpired);
      socket.off("message:reaction", handleReaction);
      socket.off("message:edited", handleEdited);
      socket.off("message:view-once-opened", handleViewOnceOpened);
      socket.off("message:listened", handleMessageListened);
      socket.off("group:new", handleGroupNew);
      socket.off("group:updated", handleGroupUpdated);
      socket.off("group:deleted", handleGroupDeleted);
      socket.off("mention:new", handleMentionNew);
      socket.off("notification:new", handleNotificationNew);
      socket.off("message:poll", handlePollUpdate);
      socket.off("typing:start", handleTypingStart);
      socket.off("typing:stop", handleTypingStop);
      socket.off("presence:snapshot", handlePresenceSnapshot);
      socket.off("presence:update", handlePresenceUpdate);
      socket.off("message:status", handleMessageStatus);
      socket.off("friend:request:new", handleFriendRequestNew);
      socket.off("friend:request:accepted", handleFriendRequestAccepted);
      socket.off("friend:removed", handleFriendRemoved);
      socket.off("chat:cleared", handleChatCleared);
      socket.off("chat:clear-undone", handleChatClearUndone);
      socket.off("user:status", handleUserStatus);
      socket.off("connect", requestPresence);
      stopTyping?.({ emit: false });
      if (typingPeerTimeoutRef?.current) {
        clearTimeout(typingPeerTimeoutRef.current);
      }
      setPeerTyping?.(false);
      setGroupTypingUsers?.([]);
    };
  }, [
    socketProp,
    hasLocalKeyring,
    user,
    users,
    groups,
    decorate,
    showToast,
    notifSettings,
    applyAcceptedFriendship,
    updateSessionUser,
    loadDirectory,
    loadFriendRequests,
    loadMyFriends,
    loadFriendDiscover,
    search,
  ]);
}
