import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import useWebRTCCall from './useWebRTCCall.js';
import useMeetingCall from './useMeetingCall.js';
import client from '../api/client.js';
import { getCurrentKeySet } from '../crypto/keyStorage.js';
import { pickRandom, sealMessage } from '../crypto/keys.js';
import { playSendSound, startIncomingRingSound } from '../utils/sounds.js';
import { shouldNotify, showNotificationPopup } from '../utils/notificationDispatch.js';

/**
 * Custom hook coordinating 1-on-1 WebRTC calls, group meetings, incoming call
 * ringtone alerts, minimization state, participant invitation, and start handlers.
 */
export default function useChatCalls({
  user,
  users = [],
  usersRef,
  groupsRef,
  selected,
  selectedRef,
  getTitle,
  notifSettings,
  showToast,
  setMessages,
  sealGroupEnvelopes,
  decorate,
  recordActivityFromMessage,
  scrollToBottom,
} = {}) {
  const [callMinimized, setCallMinimized] = useState(false);
  const [showAddParticipantModal, setShowAddParticipantModal] = useState(false);
  const notifiedCallIdRef = useRef(null);

  // Store callbacks in refs to prevent temporal dead zone issues and avoid
  // recreating dependency arrays on every render.
  const decorateRef = useRef(decorate);
  decorateRef.current = decorate;
  const recordActivityRef = useRef(recordActivityFromMessage);
  recordActivityRef.current = recordActivityFromMessage;
  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;
  const getTitleRef = useRef(getTitle);
  getTitleRef.current = getTitle;
  const sealGroupEnvelopesRef = useRef(sealGroupEnvelopes);
  sealGroupEnvelopesRef.current = sealGroupEnvelopes;

  const webrtc = useWebRTCCall({
    userId: user?.id,
    resolvePeerPublicKeys: async (peerId) => {
      if (String(peerId) === String(user?.id)) return user?.publicKeys || [];
      const peer =
        (selectedRef?.current?.type === "dm" &&
          String(selectedRef?.current?.id) === String(peerId) &&
          selectedRef?.current?.peer) ||
        usersRef?.current?.find((u) => String(u.id) === String(peerId));
      return peer?.publicKeys || [];
    },
    onMissed: (call) => {
      showToast?.("Call ended or declined", "info");
      if (notifSettings?.callNotifications?.missedCallReminders === false) return;
      if (!shouldNotify(notifSettings, { kind: "call" })) return;
      const caller =
        users.find((u) => String(u.id) === String(call?.peerId))?.displayName ||
        users.find((u) => String(u.id) === String(call?.peerId))?.username ||
        "Someone";
      showNotificationPopup(
        { title: caller, body: "Missed call" },
        notifSettings,
        () => { },
      );
    },
    onEnd: async (info) => {
      try {
        if (info.role !== "caller") return;
        const peerId = String(info.peerId);
        const peer = usersRef?.current?.find((u) => String(u.id) === peerId);
        const myKey = pickRandom(getCurrentKeySet(user.id));
        const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
        if (!myKey?.publicKey || recipientKeys.length === 0) return;
        const payload = JSON.stringify({
          __type: "call",
          callId: info.callId,
          video: info.video,
          role: info.role,
          answered: !!info.answered,
          durationSeconds: Number(info.durationSeconds) || 0,
          reason: info.reason || null,
          endedAt: new Date().toISOString(),
        });
        const forRecipient = sealMessage(payload, pickRandom(recipientKeys));
        const forSender = sealMessage(payload, myKey.publicKey);
        const { data } = await client.post("/messages", {
          to: peerId,
          forRecipient,
          forSender,
        });
        if (recordActivityRef.current) {
          recordActivityRef.current(data.data);
        }
        setMessages?.((prev) => {
          const id = String(data.data.id || data.data._id);
          if (prev.some((m) => String(m.id || m._id) === id)) return prev;
          const decorated = decorateRef.current
            ? decorateRef.current(data.data)
            : data.data;
          return [...prev, decorated];
        });
        playSendSound();
        setTimeout(() => {
          if (scrollToBottomRef.current) {
            scrollToBottomRef.current("smooth");
          }
        }, 50);
      } catch (err) {
        /* ignore send errors */
      }
    },
  });

  const meetingCall = useMeetingCall({
    userId: user?.id,
    resolveGroupMembers: async (groupId) => {
      const group =
        (selectedRef?.current?.type === "group" &&
          String(selectedRef?.current?.id) === String(groupId) &&
          selectedRef?.current?.group) ||
        groupsRef?.current?.find((g) => String(g.id) === String(groupId));
      if (!group) return null;
      return { groupName: group.name, members: group.members || [] };
    },
    onEnd: async (info) => {
      try {
        if (info.role !== "host") return;
        const group = groupsRef?.current?.find(
          (g) => String(g.id) === String(info.groupId),
        );
        if (!group) return;
        const payload = JSON.stringify({
          __type: "meeting",
          meetingId: info.meetingId,
          video: info.video,
          participantCount: info.participantCount,
          durationSeconds: Number(info.durationSeconds) || 0,
          reason: info.reason || null,
          endedAt: new Date().toISOString(),
        });
        const isPublic = group.visibility === "public";
        const body = { kind: "text" };
        if (isPublic) {
          body.content = payload;
        } else {
          body.envelopes = sealGroupEnvelopesRef.current
            ? sealGroupEnvelopesRef.current(payload, group)
            : [];
        }
        const { data } = await client.post(
          `/groups/${group.id}/messages`,
          body,
        );
        if (recordActivityRef.current) {
          recordActivityRef.current(data.data);
        }
        setMessages?.((prev) => {
          const id = String(data.data.id || data.data._id);
          if (prev.some((m) => String(m.id || m._id) === id)) return prev;
          const decorated = decorateRef.current
            ? decorateRef.current(data.data)
            : data.data;
          return [...prev, decorated];
        });
        playSendSound();
        setTimeout(() => {
          if (scrollToBottomRef.current) {
            scrollToBottomRef.current("smooth");
          }
        }, 50);
      } catch (err) {
        /* ignore send errors */
      }
    },
  });

  useEffect(() => {
    const call = webrtc.call;
    if (!call || call.role !== "callee" || call.status !== "incoming") return;

    const enabled = call.video
      ? notifSettings?.callNotifications?.videoCallEnabled !== false
      : notifSettings?.callNotifications?.voiceCallEnabled !== false;
    if (!enabled || !shouldNotify(notifSettings, { kind: "call" })) return;

    const caller =
      users?.find((u) => String(u.id) === String(call.peerId))?.displayName ||
      users?.find((u) => String(u.id) === String(call.peerId))?.username ||
      "Someone";

    if (notifiedCallIdRef.current !== call.callId) {
      notifiedCallIdRef.current = call.callId;
      showNotificationPopup(
        {
          title: caller,
          body: call.video ? "Incoming video call" : "Incoming voice call",
          requireInteraction: true,
          silent: false,
          tag: `call:${call.callId}`,
        },
        notifSettings,
        () => {
          window.focus();
        },
      );
      if (notifSettings?.callNotifications?.vibrateOnCall && navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }
    }

    const volumeScale =
      typeof notifSettings?.soundVolume === "number"
        ? notifSettings.soundVolume / 100
        : 0.8;
    const stopRing =
      notifSettings?.soundEnabled === false
        ? () => { }
        : startIncomingRingSound(volumeScale);

    return () => {
      stopRing();
    };
  }, [webrtc.call, users, notifSettings]);

  useEffect(() => {
    if (!webrtc.call) setCallMinimized(false);
  }, [webrtc.call]);

  const handleStartCall = useCallback(
    async (video) => {
      if (!selected || selected.type !== "dm") return;
      if (selected.isSelfChat || String(selected.id) === String(user?.id)) return;
      const peerName = getTitleRef.current ? getTitleRef.current() : "";
      try {
        await webrtc.startCall({
          peerId: selected.id,
          peerName,
          video,
        });
      } catch (err) {
        showToast?.(
          err.response?.data?.error ||
            err.message ||
            "Could not start the call. Check your connection and try again.",
          "error",
        );
      }
    },
    [selected, user?.id, webrtc, showToast],
  );

  const handleStartMeeting = useCallback(
    async (video) => {
      if (!selected || selected.type !== "group") return;
      try {
        await meetingCall.startMeeting({
          groupId: selected.id,
          video,
        });
      } catch (err) {
        showToast?.(
          err.response?.data?.error ||
            err.message ||
            "Could not start the meeting. Check your connection and try again.",
          "error",
        );
      }
    },
    [selected, meetingCall, showToast],
  );

  const handleAddParticipant = useCallback(
    async (targetUser) => {
      try {
        if (meetingCall.meeting) {
          await meetingCall.inviteParticipant(targetUser);
          showToast?.(
            `Invited ${targetUser.displayName || targetUser.username} to call`,
            "success",
          );
        } else if (webrtc.call) {
          const originalPeerId = webrtc.call.peerId;
          const originalPeerUser = users?.find(
            (u) => String(u.id) === String(originalPeerId),
          );
          await meetingCall.startMeeting({
            video: Boolean(webrtc.call.video),
          });
          await meetingCall.inviteParticipant({
            id: originalPeerId,
            publicKeys: originalPeerUser?.publicKeys || [],
          });
          await meetingCall.inviteParticipant(targetUser);
          webrtc.hangup();
          showToast?.(
            `Created group meeting & invited ${targetUser.displayName || targetUser.username}`,
            "success",
          );
        }
      } catch (err) {
        showToast?.("Could not invite participant", "error");
      }
    },
    [meetingCall, webrtc, users, showToast],
  );

  const currentParticipantIds = useMemo(() => {
    if (meetingCall.meeting) {
      return [user?.id, ...Array.from(meetingCall.participants.keys())];
    }
    if (webrtc.call) {
      return [user?.id, webrtc.call.peerId];
    }
    return [user?.id];
  }, [meetingCall.meeting, meetingCall.participants, webrtc.call, user?.id]);

  return {
    webrtc,
    meetingCall,
    callMinimized,
    setCallMinimized,
    showAddParticipantModal,
    setShowAddParticipantModal,
    handleStartCall,
    handleStartMeeting,
    handleAddParticipant,
    currentParticipantIds,
    isCallActive: Boolean(webrtc.call || meetingCall.meeting),
  };
}
