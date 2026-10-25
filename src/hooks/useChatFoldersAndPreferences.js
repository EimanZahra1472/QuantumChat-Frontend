import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChatFolder,
  deleteChatFolder,
  setChatFolderMembership,
  updateChatFolder,
} from "../api/client.js";
import {
  getArchivedChatKeys,
  getMutedChatKeys,
  getPinnedChatKeys,
  toggleMuteChat,
} from "../utils/chatPrefs.js";

/**
 * Custom hook to manage chat folders and chat preferences:
 * - Folder editor modal state, folder list, active folder, and folder CRUD handlers
 * - Muted chat keys state, with server and localStorage reconciliation
 * - Archived chat keys state
 * - Pinned chat keys state
 */
export default function useChatFoldersAndPreferences({
  user,
  filter,
  setFilter,
  updateSessionUser,
  showToast,
} = {}) {
  const userRef = useRef(user);
  userRef.current = user;

  // { folder: existing folder | null, initialKeys: string[] } while the
  // create/edit folder dialog is open.
  const [folderEditor, setFolderEditor] = useState(null);
  const [mutedKeys, setMutedKeys] = useState(() => getMutedChatKeys(user?.id));
  const [archivedKeys, setArchivedKeys] = useState(() =>
    getArchivedChatKeys(user?.id),
  );
  const [pinnedChatKeys, setPinnedChatKeys] = useState(() =>
    getPinnedChatKeys(user?.id),
  );

  useEffect(() => {
    if (!user?.id || !Array.isArray(user.mutedChats)) return;
    const now = Date.now();
    const serverMutedKeys = user.mutedChats
      .filter((m) => m.expiresAt == null || new Date(m.expiresAt).getTime() > now)
      .map((m) => String(m.conversationKey));
    const serverSet = new Set(serverMutedKeys);

    // Server is the source of truth once user.mutedChats has loaded — fully replace,
    // not merge, so unmutes actually take effect (not just adds).
    setMutedKeys(serverMutedKeys);

    // Reconcile chatPrefs.js localStorage both ways too, since isChatMuted() elsewhere
    // (socket handlers, sound-on-message checks) reads directly from localStorage, not from state.
    const localSet = new Set(getMutedChatKeys(user.id).map(String));
    serverSet.forEach((key) => {
      if (!localSet.has(key)) toggleMuteChat(user.id, key);
    });
    localSet.forEach((key) => {
      if (!serverSet.has(key)) toggleMuteChat(user.id, key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.mutedChats]);

  const chatFolders = useMemo(
    () => (Array.isArray(user?.chatFolders) ? user.chatFolders : []),
    [user?.chatFolders],
  );

  const activeFolder = filter?.startsWith("folder:")
    ? chatFolders.find((f) => `folder:${f.id}` === filter) || null
    : null;

  // A folder deleted here or on another device can't stay selected.
  useEffect(() => {
    if (filter?.startsWith("folder:") && !activeFolder) setFilter?.("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, activeFolder]);

  const applyFolders = useCallback(
    (folders) => {
      if (Array.isArray(folders)) {
        updateSessionUser?.({ ...userRef.current, chatFolders: folders });
      }
    },
    [updateSessionUser],
  );

  const handleSaveFolder = useCallback(
    async ({ name, conversationKeys }) => {
      const existing = folderEditor?.folder;
      if (existing) {
        const res = await updateChatFolder(existing.id, { name, conversationKeys });
        applyFolders(res.data);
        showToast?.(`Saved “${name}”`, "success");
        return;
      }
      const res = await createChatFolder({ name, conversationKeys });
      applyFolders(res.data);
      if (res.folderId) setFilter?.(`folder:${res.folderId}`);
      showToast?.(`Folder “${name}” created`, "success");
    },
    [folderEditor?.folder, applyFolders, showToast, setFilter],
  );

  const handleDeleteFolder = useCallback(async () => {
    const existing = folderEditor?.folder;
    if (!existing) return;
    const res = await deleteChatFolder(existing.id);
    applyFolders(res.data);
    showToast?.(`Folder “${existing.name}” deleted`, "info");
  }, [folderEditor?.folder, applyFolders, showToast]);

  const handleToggleChatInFolder = useCallback(
    async (folder, conversation) => {
      const key = String(conversation.key);
      const included = !folder.conversationKeys.map(String).includes(key);
      // Optimistic: flip locally, then take the server's list as truth.
      const before = chatFolders;
      applyFolders(
        chatFolders.map((f) =>
          f.id === folder.id
            ? {
                ...f,
                conversationKeys: included
                  ? [...f.conversationKeys, key]
                  : f.conversationKeys.filter((k) => String(k) !== key),
              }
            : f,
        ),
      );
      try {
        const res = await setChatFolderMembership(folder.id, key, included);
        applyFolders(res.data);
        showToast?.(
          included ? `Added to “${folder.name}”` : `Removed from “${folder.name}”`,
          "info",
        );
      } catch (err) {
        applyFolders(before);
        showToast?.(err.response?.data?.error || "Could not update folder", "error");
      }
    },
    [chatFolders, applyFolders, showToast],
  );

  return {
    folderEditor,
    setFolderEditor,
    mutedKeys,
    setMutedKeys,
    archivedKeys,
    setArchivedKeys,
    pinnedChatKeys,
    setPinnedChatKeys,
    chatFolders,
    activeFolder,
    applyFolders,
    handleSaveFolder,
    handleDeleteFolder,
    handleToggleChatInFolder,
  };
}
