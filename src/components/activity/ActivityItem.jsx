import { formatDistanceToNow } from 'date-fns';
import {
  AtSign,
  Bell, ChevronRight,
  MessageCircle,
  PhoneMissed,
  Radio,
  SmilePlus,
  Tag,
  UserPlus, Users,
} from 'lucide-react';

const ICONS = {
  friend_request: UserPlus,
  group: Users,
  mention: AtSign,
  reaction: SmilePlus,
  message: MessageCircle,
  story_mention: Tag,
  missed_call: PhoneMissed,
  live: Radio,
};

export default function ActivityItem({ item = {}, onOpen = () => {} }) {
  const when = item.at ? formatDistanceToNow(new Date(item.at), { addSuffix: true }) : '';
  let title = '';
  const actor = item.actorIsCurrentUser ? 'You' : (item.actorLabel || item.actorName || 'Someone');
  const originalAuthor = item.originalAuthorIsCurrentUser ? 'your' : (item.originalAuthorLabel ? `${item.originalAuthorLabel}'s` : 'a');
  switch (item.type) {
    case 'friend_request':
      if (item.action === 'accepted') title = `${actor} accepted your friend request`;
      else title = item.actorLabel || item.actorIsCurrentUser ? `${actor} sent you a friend request` : 'New friend request';
      break;
    case 'message': {
      const n = Number(item.count) || 1;
      title = `${actor} sent you ${n > 1 ? `${n} new messages` : 'a new message'}`;
      break;
    }
    case 'mention':
      title = `${actor} mentioned you${item.groupName ? ` in ${item.groupName}` : ' in a group'}`;
      break;
    case 'story_mention':
      title = `${actor} tagged you in their story`;
      break;
    case 'missed_call':
      title = `Missed ${item.callType === 'video' ? 'video ' : ''}call from ${actor}`;
      break;
    case 'live':
      title = item.invited
        ? `${actor} invited you to watch their live video`
        : `${actor} went live${item.title ? `: ${item.title}` : ''}`;
      break;
    case 'reaction':
      title = `${actor} reacted${item.emoji ? ` ${item.emoji}` : ''} to ${originalAuthor} message`;
      break;
    case 'group':
      if (item.action === 'deleted') {
        title = `${item.groupName || 'Group'} was deleted by ${actor}`;
      } else {
        title = `${actor} ${item.action || 'updated'} the group${item.groupName ? ` ${item.groupName}` : ''}`;
      }
      break;
    default:
      title = item.type || 'Activity';
  }

  const Icon = ICONS[item.type] || Bell;
  const iconClass = ICONS[item.type] ? `type-${item.type}` : 'type-default';

  return (
    <div
      className={`activity-item${item.unread ? ' is-unread' : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <span className={`activity-item-icon ${iconClass}`} aria-hidden="true">
        <Icon size={18} strokeWidth={2.2} />
      </span>
      <div className="activity-item-main">
        <div className="activity-item-title">{title}</div>
        {item.preview ? <div className="activity-item-preview">{item.preview}</div> : null}
        <div className="activity-item-meta">{when}</div>
      </div>
      {item.unread ? <span className="activity-unread-dot" aria-label="Unread" /> : null}
      <ChevronRight size={16} className="activity-item-chevron" aria-hidden="true" />
    </div>
  );
}
