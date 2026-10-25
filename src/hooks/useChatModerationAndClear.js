import { useRef, useState } from "react";
import client from "../api/client.js";
import { hideChat } from "../utils/hiddenChats.js";
import {
  clearAllStarred,
  getStarredEntries,
  restoreStarredEntries,
} from "../utils/messageExtras.js";

/**
 * Custom hook to manage user blocking/unblocking and chat clear/undo operations.
 */
export default function useChatModerationAndClear({
  user,
  updateSessionUser,
  showToast,
  selected,
  selectedRef,
  messages,
  setMessages,
  setLoadingMessages,
  decorateRef,
  setStarredIds,
  setUsers,
  setHiddenChatIds,
  setConfirmDialog,
  setConfirmBusy,
  applyConversationSelection,
  setError,
} = {}) {
  const [clearChatOpen, setClearChatOpen] = useState(false);
  const [clearChatBusy, setClearChatBusy] = useState(false);

  const applyConversationSelectionRef = useRef(applyConversationSelection);
  applyConversationSelectionRef.current = applyConversationSelection;

  function handleBlockUser(u) {
    setConfirmDialog({
      type: "block",
      user: u,
      title: `Block ${u.username}?`,
      message:
        "They’ll be removed from your list and you won’t be able to message each other. Chat history is kept.",
      confirmLabel: "Block",
      danger: true,
    });
  }

  async function executeBlockUser(u) {
    try {
      setConfirmBusy(true);
      const { data } = await client.post(`/users/${u.id}/block`);
      updateSessionUser(data.data);
      setUsers((prev) =>
        prev.filter((peer) => String(peer.id) !== String(u.id)),
      );
      setHiddenChatIds(hideChat(user.id, u.id));
      if (selected?.type === "dm" && String(selected.id) === String(u.id)) {
        applyConversationSelectionRef.current(null);
      }
      setError("");
      setConfirmDialog(null);
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to block user", "error");
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  function handleClearChat() {
    if (!selected) return;
    setClearChatOpen(true);
  }

  async function executeClearChatScoped(scopes) {
    if (!selected) return;
    const type = selected.type;
    const id = selected.id;
    const conversationKey = selected.key;
    const clearingStarred = scopes.includes("starred");
    const CONTENT_SCOPES = ["photo", "video", "voice", "document", "text"];
    let serverScopes = scopes.filter((s) => s !== "starred");
    // Selecting every content type is a full clear — use the single 'all'
    // watermark so we don't leave five overlapping scoped entries.
    if (CONTENT_SCOPES.every((k) => serverScopes.includes(k))) {
      serverScopes = ["all"];
    }

    // Snapshot for Undo (toast stays up ~8s).
    const previousClearedEntries = (user.clearedConversations || [])
      .filter((c) => c && c.conversationKey === conversationKey)
      .map((c) => ({
        conversationKey: c.conversationKey,
        scope: c.scope || "all",
        clearedAt: c.clearedAt,
      }));
    const previousMessages =
      selectedRef.current &&
      selectedRef.current.type === type &&
      String(selectedRef.current.id) === String(id)
        ? messages
        : null;
    const previousStarredEntries = clearingStarred
      ? getStarredEntries(user.id)
      : null;

    try {
      setClearChatBusy(true);

      if (serverScopes.length) {
        const payload =
          type === "group"
            ? { groupId: id, scopes: serverScopes }
            : { peerId: id, scopes: serverScopes };
        const { data } = await client.post("/users/me/clear-chat", payload);
        // Server confirmed — persist the updated watermarks to the session.
        // No optimistic clear: if the request had failed, existing messages
        // stay intact.
        if (data?.data) updateSessionUser(data.data);
      }

      if (clearingStarred) {
        setStarredIds(clearAllStarred(user.id));
      }

      const current = selectedRef.current;
      if (current && current.type === type && String(current.id) === String(id)) {
        if (serverScopes.includes("all")) {
          setMessages([]);
        } else if (serverScopes.length) {
          // Re-fetch rather than blanking outright — a scoped clear (e.g. just
          // photos) should still leave the remaining messages visible.
          setLoadingMessages(true);
          const endpoint = type === "group" ? `/groups/${id}/messages` : `/messages/${id}`;
          try {
            const res = await client.get(endpoint, { params: { limit: 80, markRead: 0 } });
            setMessages((res.data.data || []).map((raw) => decorateRef.current(raw)));
          } finally {
            setLoadingMessages(false);
          }
        }
      }

      const toastLabel = serverScopes.includes("all")
        ? "Chat cleared"
        : serverScopes.length
          ? "Selected messages cleared"
          : clearingStarred
            ? "Starred messages cleared"
            : "Chat cleared";

      let undoUsed = false;
      showToast(toastLabel, "success", 8000, {
        actionLabel: "Undo",
        onAction: () => {
          if (undoUsed) return;
          undoUsed = true;
          void undoClearChat({
            type,
            id,
            previousClearedEntries,
            previousMessages,
            previousStarredEntries,
            hadServerClear: serverScopes.length > 0,
          });
        },
      });
      setClearChatOpen(false);
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to clear chat", "error");
    } finally {
      setClearChatBusy(false);
    }
  }

  async function undoClearChat({
    type,
    id,
    previousClearedEntries,
    previousMessages,
    previousStarredEntries,
    hadServerClear,
  }) {
    try {
      if (hadServerClear) {
        const payload =
          type === "group"
            ? { groupId: id, restoreEntries: previousClearedEntries }
            : { peerId: id, restoreEntries: previousClearedEntries };
        const { data } = await client.post("/users/me/clear-chat/undo", payload);
        if (data?.data) updateSessionUser(data.data);
      }

      if (previousStarredEntries) {
        setStarredIds(restoreStarredEntries(user.id, previousStarredEntries));
      }

      const current = selectedRef.current;
      if (current && current.type === type && String(current.id) === String(id)) {
        if (Array.isArray(previousMessages)) {
          setMessages(previousMessages);
        } else {
          setLoadingMessages(true);
          const endpoint = type === "group" ? `/groups/${id}/messages` : `/messages/${id}`;
          try {
            const res = await client.get(endpoint, { params: { limit: 80, markRead: 0 } });
            setMessages((res.data.data || []).map((raw) => decorateRef.current(raw)));
          } finally {
            setLoadingMessages(false);
          }
        }
      }

      showToast("Clear undone", "success", 2500);
    } catch (err) {
      showToast(err.response?.data?.error || "Could not undo clear", "error");
    }
  }

  async function handleUnblockUser(peerId) {
    try {
      const { data } = await client.delete(`/users/${peerId}/block`);
      updateSessionUser(data.data);
      showToast("User unblocked", "success");
    } catch (err) {
      showToast(err.response?.data?.error || "Failed to unblock", "error");
    }
  }

  return {
    clearChatOpen,
    setClearChatOpen,
    clearChatBusy,
    setClearChatBusy,
    handleBlockUser,
    executeBlockUser,
    handleClearChat,
    executeClearChatScoped,
    undoClearChat,
    handleUnblockUser,
  };
}
