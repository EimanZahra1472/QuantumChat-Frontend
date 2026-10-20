import { Eye, Radio } from 'lucide-react';
import UserAvatar from '../UserAvatar.jsx';
import '../../styles/liveStream.css';

/** Sidebar strip: a "Go live" button plus everyone in your audience who is live right now. */
export default function LiveNowRail({ streams = [], onGoLive, onWatch, disabled = false }) {
  const others = streams.filter((s) => !s.isHost);
  return (
    <div className="live-rail" aria-label="Live now">
      <button type="button" className="live-rail-go" onClick={onGoLive} disabled={disabled}>
        <Radio size={15} aria-hidden="true" /> Go live
      </button>
      {others.map((s) => {
        const name = s.host?.displayName || s.host?.username || 'Friend';
        return (
          <button
            key={s.id}
            type="button"
            className="live-rail-chip"
            onClick={() => onWatch?.(s.id)}
            title={s.title ? `${name}: ${s.title}` : `${name} is live`}
            aria-label={`Watch ${name}'s live video${s.title ? `: ${s.title}` : ''}`}
          >
            <span className="live-rail-avatar">
              <UserAvatar userId={s.host?.id} name={name} hasAvatar={s.host?.hasAvatar} size="sm" />
              <span className="live-badge live-badge-sm">LIVE</span>
            </span>
            <span className="live-rail-name">{name}</span>
            <span className="live-rail-count">
              <Eye size={12} aria-hidden="true" /> {s.viewerCount || 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
