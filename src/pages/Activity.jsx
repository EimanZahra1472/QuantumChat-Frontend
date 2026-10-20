import {
  ArrowLeft,
  AtSign,
  Clock,
  Layers,
  MessageCircle,
  MessageSquare,
  PhoneMissed,
  SmilePlus,
  Sparkles,
  Tag,
  UserPlus, Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from '../api/notifications.js';
import ActivityTimeline from '../components/activity/ActivityTimeline.jsx';
import ScreenTimeChart from '../components/activity/ScreenTimeChart.jsx';
import '../styles/activity.css';

const FILTERS = [
  { id: 'all', label: 'All', icon: Layers },
  { id: 'message', label: 'Messages', icon: MessageCircle },
  { id: 'friend_request', label: 'Friend Requests', icon: UserPlus },
  { id: 'group', label: 'Groups', icon: Users },
  { id: 'mention', label: 'Mentions', icon: AtSign },
  { id: 'story_mention', label: 'Story Tags', icon: Tag },
  { id: 'missed_call', label: 'Missed Calls', icon: PhoneMissed },
  { id: 'reaction', label: 'Reactions', icon: SmilePlus },
];

// Backend Notification row -> shape ActivityItem renders.
function toActivityItem(n, groupNames) {
  const actorLabel = n.actor?.username || '';
  const base = {
    id: n.id,
    at: n.createdAt,
    unread: !n.read,
    actorLabel,
    actorId: n.actor?.id ? String(n.actor.id) : '',
  };
  const meta = n.metadata || {};
  switch (n.type) {
    case 'NEW_MESSAGE':
      return {
        ...base, type: 'message', count: meta.count || 1,
        route: base.actorId ? `/chat/${base.actorId}` : null,
      };
    case 'FRIEND_REQUEST':
      return { ...base, type: 'friend_request', route: '/chat' };
    case 'FRIEND_REQUEST_ACCEPTED':
      return {
        ...base, type: 'friend_request', action: 'accepted',
        route: base.actorId ? `/chat/${base.actorId}` : '/chat',
      };
    case 'MESSAGE_REACTION':
      return {
        ...base, type: 'reaction', emoji: meta.emoji, originalAuthorIsCurrentUser: true,
        route: meta.groupId ? `/chat/g/${meta.groupId}` : (base.actorId ? `/chat/${base.actorId}` : null),
      };
    case 'GROUP_MENTION': {
      const gid = meta.groupId ? String(meta.groupId) : (n.entityType === 'group' ? String(n.entityId) : '');
      return {
        ...base, type: 'mention', groupName: meta.groupName || groupNames[gid] || '',
        route: gid ? `/chat/g/${gid}` : null,
      };
    }
    case 'STORY_MENTION':
      return {
        ...base, type: 'story_mention',
        route: base.actorId ? `/chat/${base.actorId}` : '/chat',
      };
    case 'MISSED_CALL':
      return {
        ...base, type: 'missed_call', callType: meta.callType,
        route: base.actorId ? `/chat/${base.actorId}` : null,
      };
    case 'LIVE_STARTED': {
      const streamId = meta.streamId || n.entityId;
      return {
        ...base, type: 'live', title: meta.title || '', invited: Boolean(meta.invited),
        route: streamId ? `/chat/live/${streamId}` : '/chat',
      };
    }
    case 'GROUP_EVENT': {
      const gid = meta.groupId ? String(meta.groupId) : '';
      return {
        ...base, type: 'group', action: meta.action, groupName: meta.groupName || groupNames[gid] || '',
        route: gid ? `/chat/g/${gid}` : null,
      };
    }
    default:
      return { ...base, type: 'default', route: null };
  }
}

export default function Activity() {
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [groupNames, setGroupNames] = useState({});
  const [conversationCount, setConversationCount] = useState(0);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const res = await listNotifications({ limit: 50 });
      setRows(res.items);
      setHasMore(res.hasMore);
    } catch {
      /* keep whatever we had */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    try {
      const res = await listNotifications({ limit: 50, before: last.createdAt });
      setRows((prev) => [...prev, ...res.items]);
      setHasMore(res.hasMore);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      client.get('/users', { params: { limit: 100 } }),
      client.get('/groups', { params: { limit: 100 } }),
    ]).then(([usersRes, groupsRes]) => {
      if (!active) return;
      const users = usersRes.data?.data || [];
      const groups = groupsRes.data?.data || [];
      setConversationCount(users.length + groups.length);
      const names = {};
      groups.forEach((g) => { names[String(g._id || g.id)] = g.name; });
      setGroupNames(names);
    }).catch(() => {
      if (active) setConversationCount(0);
    });
    return () => { active = false; };
  }, []);

  const allItems = useMemo(() => rows.map((n) => toActivityItem(n, groupNames)), [rows, groupNames]);
  const items = useMemo(
    () => (filter === 'all' ? allItems : allItems.filter((it) => it.type === filter)),
    [allItems, filter]
  );
  const unreadTotal = useMemo(() => allItems.filter((it) => it.unread).length, [allItems]);

  const handleOpen = async (it) => {
    if (it.unread) {
      setRows((prev) => prev.map((n) => (n.id === it.id ? { ...n, read: true } : n)));
      markNotificationsRead([it.id]).catch(() => {});
    }
    if (it.route) navigate(it.route);
  };

  const handleMarkAll = async () => {
    setRows((prev) => prev.map((n) => ({ ...n, read: true })));
    try { await markAllNotificationsRead(); } catch { load(); }
  };

  const counts = useMemo(() => ({ conversations: conversationCount }), [conversationCount]);

  return (
    <div className="activity-page">
      <div className="activity-container">
        <header className="page-header">
          <div className="page-header-top">
            <button
              type="button"
              className="activity-back-button"
              onClick={() => navigate('/chat')}
              aria-label="Back to chat"
              title="Back to chat"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              <span>Back to chat</span>
            </button>
            <div className={`activity-badge${unreadTotal ? ' has-unread' : ''}`}>
              <span className="activity-badge-dot" />
              <span>Activity Hub</span>
            </div>
          </div>
          <div className="page-header-title-wrap">
            <h1>Chat Activity</h1>
            <p className="muted">Messages, friend requests, mentions, story tags, missed calls and screen time.</p>
          </div>
        </header>

        <div className="activity-grid">
          <main className="activity-main">
            <div className="activity-controls">
              <div className="segmented" role="tablist" aria-label="Activity filter">
                {FILTERS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={filter === id}
                    className={`seg-btn ${filter === id ? 'active' : ''}`}
                    onClick={() => setFilter(id)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="activity-mark-all-btn"
                onClick={handleMarkAll}
                disabled={!unreadTotal}
              >
                Mark all read
              </button>
            </div>

            <div className="card activity-feed-card">
              <div className="activity-feed-head">
                <h3>
                  <Sparkles size={16} style={{ color: 'var(--accent)' }} />
                  <span>Recent activity</span>
                </h3>
                <span className="feed-count-badge">
                  {loading ? '…' : `${items.length} ${items.length === 1 ? 'event' : 'events'}`}
                </span>
              </div>
              <div className="activity-feed-body">
                <ActivityTimeline items={items} onOpen={handleOpen} />
                {hasMore && filter === 'all' && (
                  <button type="button" className="activity-mark-all-btn activity-load-more" onClick={loadMore}>
                    Load more
                  </button>
                )}
              </div>
            </div>
          </main>

          <aside className="activity-side">
            <div className="card activity-stat-card">
              <div className="stat-card-header">
                <div className="stat-card-icon-wrap">
                  <MessageSquare size={18} />
                </div>
                <span className="stat-badge">Active</span>
              </div>
              <div className="stat-card-body">
                <div className="big-count">{counts.conversations}</div>
                <div className="stat-card-label">Conversations</div>
                <p className="muted">Direct chats & group channels joined</p>
              </div>
            </div>

            <div className="card activity-stat-card">
              <div className="stat-card-header">
                <div className="stat-card-icon-wrap">
                  <Clock size={18} />
                </div>
                <span className="stat-badge">Analytics</span>
              </div>
              <div className="stat-card-body">
                <ScreenTimeChart />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
