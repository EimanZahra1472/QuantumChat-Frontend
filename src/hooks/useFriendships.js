import React, { useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { getSocket } from '../api/socket.js';

/**
 * Custom hook managing friendship lifecycle, user directory loading,
 * friend requests, friend discovery, and contact lookup.
 */
export default function useFriendships({
  user,
  userRef,
  hasLocalKeyring,
  setUsers,
  setGroups,
  updateSessionUser,
  showToast,
  search,
  filter,
  setConfirmDialog,
} = {}) {
  const [friendCandidates, setFriendCandidates] = useState([]);
  const [friendCandidatesLoading, setFriendCandidatesLoading] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [myFriends, setMyFriends] = useState([]);
  const [myFriendsLoading, setMyFriendsLoading] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [contactLookupResult, setContactLookupResult] = useState(null);
  const [contactLookupLoading, setContactLookupLoading] = useState(false);
  const [contactLookupError, setContactLookupError] = useState("");

  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersCursor, setUsersCursor] = useState(null);
  const [usersHasMore, setUsersHasMore] = useState(false);
  const [groupsCursor, setGroupsCursor] = useState(null);
  const [groupsHasMore, setGroupsHasMore] = useState(false);

  const loadDirectory = useCallback(() => {
    if (!hasLocalKeyring) return;
    setLoadingUsers(true);

    const usersReq = client
      .get("/users", { params: { limit: 20 } })
      .then((res) => {
        setUsers?.(res.data.data || []);
        setUsersHasMore(Boolean(res.data.meta?.hasMore));
        setUsersCursor(res.data.meta?.nextCursor || null);
      })
      .catch((err) =>
        showToast?.(err.response?.data?.error || "Failed to load users", "error"),
      );

    const groupsReq = client
      .get("/groups", { params: { limit: 20 } })
      .then((res) => {
        setGroups?.(res.data.data || []);
        setGroupsHasMore(Boolean(res.data.meta?.hasMore));
        setGroupsCursor(res.data.meta?.nextCursor || null);
      })
      .catch(() => setGroups?.([]));

    Promise.allSettled([usersReq, groupsReq]).finally(() =>
      setLoadingUsers(false),
    );
  }, [hasLocalKeyring, setUsers, setGroups, showToast]);

  const loadMoreContacts = useCallback(() => {
    if (!hasLocalKeyring) return;
    if (usersHasMore) {
      client
        .get("/users", { params: { limit: 20, cursor: usersCursor } })
        .then((res) => {
          setUsers?.((prev) => [...prev, ...(res.data.data || [])]);
          setUsersHasMore(Boolean(res.data.meta?.hasMore));
          setUsersCursor(res.data.meta?.nextCursor || null);
        })
        .catch(() => { });
    }
    if (groupsHasMore) {
      client
        .get("/groups", { params: { limit: 20, cursor: groupsCursor } })
        .then((res) => {
          setGroups?.((prev) => [...prev, ...(res.data.data || [])]);
          setGroupsHasMore(Boolean(res.data.meta?.hasMore));
          setGroupsCursor(res.data.meta?.nextCursor || null);
        })
        .catch(() => { });
    }
  }, [hasLocalKeyring, usersHasMore, usersCursor, groupsHasMore, groupsCursor, setUsers, setGroups]);

  const loadFriendDiscover = useCallback(
    async (q) => {
      setFriendCandidatesLoading(true);
      try {
        const { data } = await client.get("/users/discover", {
          params: q?.trim() ? { q: q.trim() } : undefined,
        });
        setFriendCandidates(data.data || []);
      } catch (err) {
        showToast?.(
          err.response?.data?.error || "Failed to load people",
          "error",
        );
      } finally {
        setFriendCandidatesLoading(false);
      }
    },
    [showToast],
  );

  const loadFriendRequests = useCallback(async () => {
    try {
      const { data } = await client.get("/users/friend-requests");
      setIncomingRequests(data.data?.incoming || []);
      setOutgoingRequests(data.data?.outgoing || []);
    } catch {
      // non-fatal
    }
  }, []);

  const loadMyFriends = useCallback(async () => {
    setMyFriendsLoading(true);
    try {
      const { data } = await client.get("/users/friends");
      setMyFriends(data.data || []);
    } catch {
      setMyFriends([]);
    } finally {
      setMyFriendsLoading(false);
    }
  }, []);

  /** Instantly reflect an accepted friendship (socket or poll) — no page reload. */
  const applyAcceptedFriendship = useCallback(
    (friend, requestId) => {
      const friendId = String(friend?.id || friend?._id || "");
      if (!friendId) return;

      const current = userRef?.current || user;
      if (current) {
        const friends = Array.from(
          new Set([...(current.friends || []).map(String), friendId]),
        );
        updateSessionUser?.({ ...current, friends });
      }

      setMyFriends((prev) => {
        if (prev.some((f) => String(f.id || f._id) === friendId)) return prev;
        return [
          {
            id: friendId,
            displayName: friend.displayName,
            username: friend.username,
            hasAvatar: friend.hasAvatar,
            ...friend,
          },
          ...prev,
        ];
      });

      setOutgoingRequests((prev) =>
        prev.filter((r) => {
          if (requestId && String(r.id) === String(requestId)) return false;
          return String(r.user?.id) !== friendId;
        }),
      );
      setIncomingRequests((prev) =>
        prev.filter((r) => {
          if (requestId && String(r.id) === String(requestId)) return false;
          return String(r.user?.id) !== friendId;
        }),
      );

      setContactLookupResult((prev) =>
        prev && String(prev.id) === friendId
          ? { ...prev, requestStatus: "friends", requestId: null }
          : prev,
      );
    },
    [updateSessionUser, user, userRef],
  );

  const isFriendWith = useCallback(
    (peerId) => {
      const id = String(peerId || "");
      if (!id) return false;
      if ((user?.friends || []).map(String).includes(id)) return true;
      return myFriends.some((f) => String(f.id || f._id) === id);
    },
    [user?.friends, myFriends],
  );

  const handleLookupContact = useCallback(async () => {
    const raw = contactQuery.trim();
    setContactLookupError("");
    setContactLookupResult(null);
    if (!raw) {
      setContactLookupError("Enter an email or phone number");
      return;
    }

    const looksEmail = raw.includes("@");
    const looksPhone = /^[\d\s+\-().]{7,}$/.test(raw);
    if (!looksEmail && !looksPhone) {
      setContactLookupError("Enter a valid email or phone number");
      return;
    }

    setContactLookupLoading(true);
    try {
      const params = looksEmail
        ? { email: raw.toLowerCase() }
        : { phone: raw };
      const { data } = await client.get("/users/lookup", { params });
      if (!data.data) {
        setContactLookupError(
          looksEmail
            ? "No verified account found for that email"
            : "No account found for that phone number",
        );
        return;
      }
      setContactLookupResult(data.data);
    } catch (err) {
      setContactLookupError(
        err.response?.data?.error || "Lookup failed — try again",
      );
    } finally {
      setContactLookupLoading(false);
    }
  }, [contactQuery]);

  const onContactQueryChange = useCallback((value) => {
    setContactQuery(value);
    setContactLookupError("");
    setContactLookupResult((prev) => (prev ? null : prev));
  }, []);

  async function handleSendFriendRequest(userId) {
    try {
      const { data } = await client.post("/users/friend-requests", { to: userId });
      if (data?.data?.status === "accepted") {
        if (data?.data?.me) updateSessionUser?.(data.data.me);
        showToast?.("You are now friends", "success");
        loadMyFriends();
      } else {
        showToast?.("Friend request sent", "success");
      }
      loadFriendDiscover(search);
      loadFriendRequests();
      setContactLookupResult((prev) =>
        prev && String(prev.id) === String(userId)
          ? {
            ...prev,
            requestStatus:
              data?.data?.status === "accepted" ? "friends" : "pending_sent",
            requestId: data?.data?.id || data?.data?.requestId || prev.requestId,
          }
          : prev,
      );
    } catch (err) {
      showToast?.(err.response?.data?.error || "Failed to send request", "error");
    }
  }

  function handleNotFriendsError(err, fallbackRecipientId) {
    const errData = err?.response?.data || err?.data || err;
    if (errData?.code === 'NOT_FRIENDS') {
      const targetId = errData.recipientId || fallbackRecipientId;
      showToast?.(
        React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          React.createElement(
            'span',
            null,
            "Unable to send message — you're not friends with this user. Add them as a friend first."
          ),
          targetId
            ? React.createElement(
                'button',
                {
                  type: 'button',
                  style: {
                    alignSelf: 'flex-start',
                    padding: '4px 10px',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    borderRadius: '4px',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    marginTop: '2px',
                  },
                  onClick: (e) => {
                    e.stopPropagation();
                    handleSendFriendRequest(targetId);
                  },
                },
                'Add Friend'
              )
            : null
        ),
        "error",
        6000
      );
      return true;
    }
    return false;
  }

  async function handleCancelFriendRequest(requestId) {
    try {
      await client.delete(`/users/friend-requests/${requestId}`);
      setOutgoingRequests((prev) =>
        prev.filter((r) => String(r.id) !== String(requestId)),
      );
      loadFriendDiscover(search);
      loadFriendRequests();
      setContactLookupResult((prev) =>
        prev && String(prev.requestId) === String(requestId)
          ? { ...prev, requestStatus: "none", requestId: null }
          : prev,
      );
      showToast?.("Friend request cancelled", "success");
    } catch (err) {
      showToast?.(
        err.response?.data?.error || "Failed to cancel request",
        "error",
      );
    }
  }

  async function executeAcceptFriendRequest(requestId) {
    try {
      const pending = incomingRequests.find(
        (r) => String(r.id) === String(requestId),
      );
      const { data } = await client.post(
        `/users/friend-requests/${requestId}/accept`,
      );
      if (pending?.user) {
        applyAcceptedFriendship(pending.user, requestId);
      }
      if (data?.data?.me) {
        updateSessionUser?.(data.data.me);
      } else {
        try {
          const meRes = await client.get("/users/me");
          if (meRes.data?.data) updateSessionUser?.(meRes.data.data);
        } catch {
          // non-fatal
        }
      }
      showToast?.("Friend request accepted", "success");
      loadDirectory();
      loadFriendDiscover(search);
      loadMyFriends();
    } catch (err) {
      showToast?.(
        err.response?.data?.error || "Failed to accept request",
        "error",
      );
    }
  }

  function handleAcceptFriendRequest(requestId) {
    const pending = incomingRequests.find(
      (r) => String(r.id) === String(requestId),
    );
    if (pending?.moderationWarning?.reportedByMultiple) {
      const reasonText = pending.moderationWarning.commonReason
        ? ` The most common reason given is "${pending.moderationWarning.commonReason.replace(/_/g, ' ')}".`
        : '';
      setConfirmDialog?.({
        type: "accept-with-warning",
        requestId,
        title: "Safety warning",
        message: `${pending.user?.displayName || pending.user?.username || 'This account'} has been reported by multiple people.${reasonText} Do you still want to accept this friend request?`,
        confirmLabel: "Accept anyway",
        danger: true,
      });
      return;
    }
    executeAcceptFriendRequest(requestId);
  }

  async function handleDeclineFriendRequest(requestId) {
    try {
      await client.post(`/users/friend-requests/${requestId}/decline`);
      setIncomingRequests((prev) =>
        prev.filter((r) => String(r.id) !== String(requestId)),
      );
      loadFriendDiscover(search);
      setContactLookupResult((prev) =>
        prev && String(prev.requestId) === String(requestId)
          ? { ...prev, requestStatus: "none", requestId: null }
          : prev,
      );
    } catch (err) {
      showToast?.(
        err.response?.data?.error || "Failed to decline request",
        "error",
      );
    }
  }

  async function handleRemoveFriend(peer) {
    try {
      await client.delete(`/users/friends/${peer.id}`);
      try {
        const { data } = await client.get("/users/me");
        if (data?.data) updateSessionUser?.(data.data);
      } catch {
        // non-fatal
      }
      showToast?.("Friend removed", "success");
      loadDirectory();
      loadMyFriends();
      loadFriendDiscover(search);
    } catch (err) {
      showToast?.(
        err.response?.data?.error || "Failed to remove friend",
        "error",
      );
    }
  }

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  useEffect(() => {
    if (!user?.id) return;
    loadMyFriends();
    loadFriendRequests();
  }, [user?.id, loadMyFriends, loadFriendRequests]);

  useEffect(() => {
    if (!user?.id) return undefined;

    let cancelled = false;
    let inFlight = false;
    let primed = false;
    const knownFriendIds = new Set(
      ((userRef?.current || user)?.friends || []).map(String),
    );

    async function syncFriendState() {
      if (cancelled || inFlight) return;
      if (document.visibilityState === "hidden") return;

      const socketConnected = Boolean(getSocket()?.connected);
      const hasPending =
        outgoingRequests.length > 0 || incomingRequests.length > 0;
      // Keep polling while requests are pending (acceptances must show without
      // reload). Also poll when Socket.IO is unavailable (e.g. Vercel API).
      if (socketConnected && !hasPending) return;

      inFlight = true;
      try {
        const [reqRes, friendsRes, meRes] = await Promise.all([
          client.get("/users/friend-requests"),
          client.get("/users/friends"),
          client.get("/users/me").catch(() => null),
        ]);
        if (cancelled) return;

        setIncomingRequests(reqRes.data?.data?.incoming || []);
        setOutgoingRequests(reqRes.data?.data?.outgoing || []);

        const friends = friendsRes.data?.data || [];
        setMyFriends(friends);

        const newlyAccepted = friends.filter((f) => {
          const id = String(f.id || f._id);
          return id && !knownFriendIds.has(id);
        });
        friends.forEach((f) => {
          const id = String(f.id || f._id);
          if (id) knownFriendIds.add(id);
        });

        if (meRes?.data?.data) {
          updateSessionUser?.(meRes.data.data);
        } else {
          newlyAccepted.forEach((f) => applyAcceptedFriendship(f));
        }

        if (primed && newlyAccepted.length === 1 && hasPending) {
          const name =
            newlyAccepted[0].displayName ||
            newlyAccepted[0].username ||
            "Someone";
          showToast?.(`${name} accepted your friend request`, "success");
        }
        primed = true;
      } catch {
        // non-fatal
      } finally {
        inFlight = false;
      }
    }

    const hasPending =
      outgoingRequests.length > 0 || incomingRequests.length > 0;
    const intervalMs = hasPending ? 4000 : 12000;
    const timer = window.setInterval(syncFriendState, intervalMs);
    if (hasPending || !getSocket()?.connected) {
      syncFriendState();
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // Intentionally omit myFriends / user.friends from deps — knownFriendIds
    // is seeded once per effect run; length of pending queues drives restarts.
  }, [
    user?.id,
    outgoingRequests.length,
    incomingRequests.length,
    updateSessionUser,
    applyAcceptedFriendship,
    showToast,
  ]);

  useEffect(() => {
    if (filter === "all") {
      loadMyFriends();
    }
    if (filter !== "friends") return;
    loadFriendDiscover(search);
    loadFriendRequests();
    loadMyFriends();
  }, [filter, search, loadFriendDiscover, loadFriendRequests, loadMyFriends]);

  return {
    friendCandidates,
    setFriendCandidates,
    friendCandidatesLoading,
    incomingRequests,
    setIncomingRequests,
    outgoingRequests,
    setOutgoingRequests,
    myFriends,
    setMyFriends,
    myFriendsLoading,
    contactQuery,
    setContactQuery,
    contactLookupResult,
    setContactLookupResult,
    contactLookupLoading,
    contactLookupError,
    setContactLookupError,
    onContactQueryChange,
    loadingUsers,
    usersCursor,
    usersHasMore,
    groupsCursor,
    groupsHasMore,
    hasMoreContacts: Boolean(usersHasMore || groupsHasMore),
    loadDirectory,
    loadMoreContacts,
    loadFriendDiscover,
    loadFriendRequests,
    loadMyFriends,
    applyAcceptedFriendship,
    isFriendWith,
    handleLookupContact,
    handleSendFriendRequest,
    handleNotFriendsError,
    handleCancelFriendRequest,
    executeAcceptFriendRequest,
    handleAcceptFriendRequest,
    handleDeclineFriendRequest,
    handleRemoveFriend,
  };
}
