import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Eye,
  MessageSquare,
  MessageSquareOff,
  Mic,
  MicOff,
  RefreshCw,
  Send,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { LIVE_COMMENT_MAX, LIVE_REACTIONS } from '../../hooks/useLiveStream.js';
import UserAvatar from '../UserAvatar.jsx';
import LivePeoplePicker from './LivePeoplePicker.jsx';
import '../../styles/liveStream.css';

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hostLabel(host) {
  return host?.displayName || host?.username || 'Live';
}

function LiveVideo({ stream, mirror, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return (
    <video
      ref={ref}
      className={`live-video${mirror ? ' is-mirror' : ''}`}
      autoPlay
      playsInline
      muted={muted}
    />
  );
}

function useElapsed(startedAt, running) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return startedAt ? (now - startedAt) / 1000 : 0;
}

function EndedCard({ live, recording, onSaveRecording, onDiscardRecording, onClose }) {
  const isHost = live.role === 'host';
  const summary = live.summary || {};
  const pending = recording?.decision === 'pending';

  if (!isHost) {
    return (
      <div className="live-ended-card" role="status">
        <h2>{live.endReason === 'removed' ? 'You were removed from this live video' : 'This live video has ended'}</h2>
        <p className="live-hint">{hostLabel(live.host)}</p>
        <button type="button" className="live-btn live-btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="live-ended-card" role="status">
      <h2>Your live video has ended</h2>
      <dl className="live-summary">
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(summary.durationSeconds || 0)}</dd>
        </div>
        <div>
          <dt>Peak viewers</dt>
          <dd>{summary.peakViewers || 0}</dd>
        </div>
        <div>
          <dt>Comments</dt>
          <dd>{summary.commentCount || 0}</dd>
        </div>
      </dl>

      {recording ? (
        <div className="live-recording-choice">
          {pending ? (
            <>
              <p>
                <strong>Keep the recording?</strong>
                <br />
                <span className="live-hint">
                  {formatBytes(recording.size)} · stored only on this device until you choose.
                </span>
              </p>
              <div className="live-recording-actions">
                <button type="button" className="live-btn live-btn-danger" onClick={onDiscardRecording}>
                  <Trash2 size={16} aria-hidden="true" /> Discard
                </button>
                <button type="button" className="live-btn live-btn-primary" onClick={onSaveRecording}>
                  <Download size={16} aria-hidden="true" /> Save to device
                </button>
              </div>
            </>
          ) : (
            <p className="live-hint">Recording saved as {recording.filename}.</p>
          )}
        </div>
      ) : live.recordingEnabled ? (
        <p className="live-hint">The recording was empty, so there is nothing to save.</p>
      ) : null}

      {!pending ? (
        <button type="button" className="live-btn live-btn-primary" onClick={onClose}>
          Done
        </button>
      ) : null}
    </div>
  );
}

export default function LiveStreamOverlay({
  live,
  localStream,
  remoteStream,
  viewerCount,
  viewers,
  comments,
  reactions,
  muted,
  cameraOff,
  connection,
  recording,
  friends = [],
  onEnd,
  onLeave,
  onReconnect,
  onComment,
  onReaction,
  onToggleComments,
  onToggleMute,
  onToggleCamera,
  onInvite,
  onRemoveViewer,
  onSaveRecording,
  onDiscardRecording,
}) {
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState(null); // 'viewers' | 'invite' | null
  const [invitePicked, setInvitePicked] = useState(() => new Set());
  const [inviting, setInviting] = useState(false);
  const [inviteNote, setInviteNote] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const commentsEndRef = useRef(null);

  const isHost = live?.role === 'host';
  const isLive = live?.status === 'live';
  const elapsed = useElapsed(live?.startedAt, isLive);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ block: 'end' });
  }, [comments.length]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (panel) setPanel(null);
      else if (confirmEnd) setConfirmEnd(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panel, confirmEnd]);

  const viewerIds = useMemo(() => new Set((viewers || []).map((v) => String(v.id))), [viewers]);

  if (!live) return null;

  if (live.status === 'ended') {
    return (
      <div className="live-overlay" role="dialog" aria-modal="true" aria-label="Live video ended">
        <EndedCard
          live={live}
          recording={recording}
          onSaveRecording={onSaveRecording}
          onDiscardRecording={onDiscardRecording}
          onClose={onLeave}
        />
      </div>
    );
  }

  const commentsAllowed = live.allowComments !== false;
  const connectionLabel =
    !isHost && live.status === 'joining'
      ? 'Joining…'
      : !isHost && connection === 'connecting'
        ? 'Connecting to the live video…'
        : !isHost && connection === 'reconnecting'
          ? 'Reconnecting…'
          : live.status === 'ending'
            ? 'Ending…'
            : '';

  function submitComment(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onComment?.(text);
    setDraft('');
  }

  async function sendInvites() {
    if (!invitePicked.size) return;
    setInviting(true);
    setInviteNote('');
    try {
      const invited = await onInvite?.([...invitePicked]);
      const n = invited?.length || 0;
      setInviteNote(n ? `Invited ${n} ${n === 1 ? 'person' : 'people'}` : 'No one could be invited');
      setInvitePicked(new Set());
    } catch (err) {
      setInviteNote(err?.response?.data?.error || 'Could not send invites');
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="live-overlay" role="dialog" aria-modal="true" aria-label={`Live video: ${hostLabel(live.host)}`}>
      <div className="live-stage">
        <div className="live-video-wrap">
          {isHost ? (
            <LiveVideo stream={localStream} mirror muted />
          ) : (
            <LiveVideo stream={remoteStream} />
          )}
          {isHost && cameraOff ? <div className="live-camera-off">Camera is off</div> : null}

          {connectionLabel ? <div className="live-connection">{connectionLabel}</div> : null}
          {!isHost && connection === 'failed' ? (
            <div className="live-connection is-failed">
              <span>Couldn&apos;t connect to this live video.</span>
              <button type="button" className="live-btn live-btn-primary" onClick={onReconnect}>
                <RefreshCw size={16} aria-hidden="true" /> Try again
              </button>
            </div>
          ) : null}

          <header className="live-topbar">
            <div className="live-host">
              <UserAvatar
                userId={live.host?.id}
                name={hostLabel(live.host)}
                hasAvatar={live.host?.hasAvatar}
                size="sm"
              />
              <div className="live-host-text">
                <strong>{isHost ? 'You' : hostLabel(live.host)}</strong>
                {live.title ? <span className="live-title">{live.title}</span> : null}
                {live.group?.name ? <span className="live-title">in {live.group.name}</span> : null}
              </div>
            </div>
            <div className="live-topbar-right">
              <span className="live-badge">LIVE</span>
              <span className="live-pill" aria-label="Elapsed time">
                {formatDuration(elapsed)}
              </span>
              <button
                type="button"
                className="live-pill live-pill-btn"
                onClick={() => isHost && setPanel(panel === 'viewers' ? null : 'viewers')}
                aria-label={`${viewerCount} watching`}
                disabled={!isHost}
              >
                <Eye size={14} aria-hidden="true" /> {viewerCount}
              </button>
              {isHost && live.recordingEnabled ? (
                <span className="live-pill live-rec" aria-label="Recording">
                  ● REC
                </span>
              ) : null}
              {!isHost ? (
                <button type="button" className="live-icon-btn" onClick={onLeave} aria-label="Leave live video">
                  <X size={18} />
                </button>
              ) : null}
            </div>
          </header>

          <div className="live-reactions" aria-hidden="true">
            {reactions.map((r) => (
              <span key={r.id} className="live-reaction-float" style={{ right: `${8 + r.x * 40}px` }}>
                {r.emoji}
              </span>
            ))}
          </div>

          <div className="live-comments" aria-live="polite">
            {comments.map((c) => (
              <div key={c.id} className={`live-comment${c.from?.isHost ? ' is-host' : ''}`}>
                <strong>{c.from?.isHost ? `${c.from.name} · Host` : c.from?.name}</strong> {c.text}
              </div>
            ))}
            {!commentsAllowed ? <div className="live-comment is-system">Comments are turned off</div> : null}
            <div ref={commentsEndRef} />
          </div>
        </div>

        <div className="live-bottom">
          <form className="live-compose" onSubmit={submitComment}>
            <input
              className="live-input"
              value={draft}
              maxLength={LIVE_COMMENT_MAX}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={commentsAllowed || isHost ? 'Add a comment…' : 'Comments are off'}
              disabled={!isLive || (!commentsAllowed && !isHost) || (!isHost && connection !== 'connected')}
              aria-label="Comment"
            />
            <button type="submit" className="live-icon-btn" disabled={!draft.trim()} aria-label="Send comment">
              <Send size={18} />
            </button>
          </form>
          <div className="live-reaction-bar" role="group" aria-label="Reactions">
            {LIVE_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="live-reaction-btn"
                onClick={() => onReaction?.(emoji)}
                disabled={!isLive || (!isHost && connection !== 'connected')}
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>

          {isHost ? (
            <div className="live-controls">
              <button
                type="button"
                className={`call-ctrl${muted ? ' active' : ''}`}
                onClick={onToggleMute}
                aria-label={muted ? 'Unmute' : 'Mute'}
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button
                type="button"
                className={`call-ctrl${cameraOff ? ' active' : ''}`}
                onClick={onToggleCamera}
                aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
                title={cameraOff ? 'Turn camera on' : 'Turn camera off'}
              >
                {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
              </button>
              <button
                type="button"
                className={`call-ctrl${!commentsAllowed ? ' active' : ''}`}
                onClick={() => onToggleComments?.(!commentsAllowed)}
                aria-label={commentsAllowed ? 'Turn comments off' : 'Turn comments on'}
                title={commentsAllowed ? 'Turn comments off' : 'Turn comments on'}
              >
                {commentsAllowed ? <MessageSquare size={20} /> : <MessageSquareOff size={20} />}
              </button>
              <button
                type="button"
                className="call-ctrl"
                onClick={() => setPanel(panel === 'invite' ? null : 'invite')}
                aria-label="Invite contacts"
                title="Invite contacts"
              >
                <UserPlus size={20} />
              </button>
              <button
                type="button"
                className="call-ctrl"
                onClick={() => setPanel(panel === 'viewers' ? null : 'viewers')}
                aria-label="Viewers"
                title="Viewers"
              >
                <Users size={20} />
              </button>
              {confirmEnd ? (
                <span className="live-confirm-end">
                  <button type="button" className="live-btn" onClick={() => setConfirmEnd(false)}>
                    Keep going
                  </button>
                  <button type="button" className="live-btn live-btn-danger" onClick={onEnd} disabled={!isLive}>
                    End for everyone
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="live-btn live-btn-danger"
                  onClick={() => setConfirmEnd(true)}
                  disabled={!isLive}
                >
                  End live
                </button>
              )}
            </div>
          ) : null}
        </div>

        {isHost && panel ? (
          <aside className="live-panel" aria-label={panel === 'invite' ? 'Invite contacts' : 'Viewers'}>
            <header className="live-panel-header">
              <strong>{panel === 'invite' ? 'Invite contacts' : `Watching now (${viewerCount})`}</strong>
              <button type="button" className="live-icon-btn" onClick={() => setPanel(null)} aria-label="Close panel">
                <X size={16} />
              </button>
            </header>
            {panel === 'viewers' ? (
              <ul className="live-viewer-list">
                {viewers.length === 0 ? <li className="live-hint">No one is watching yet.</li> : null}
                {viewers.map((v) => (
                  <li key={v.id}>
                    <UserAvatar userId={v.id} name={v.name} size="sm" />
                    <span>{v.name}</span>
                    <button
                      type="button"
                      className="live-icon-btn"
                      onClick={() => onRemoveViewer?.(v.id)}
                      aria-label={`Remove ${v.name}`}
                      title="Remove from live video"
                    >
                      <UserMinus size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <LivePeoplePicker
                  people={friends}
                  selected={invitePicked}
                  onToggle={(id) =>
                    setInvitePicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  disabledIds={viewerIds}
                  disabledHint="Watching"
                  ariaLabel="Contacts to invite"
                />
                {inviteNote ? <p className="live-hint">{inviteNote}</p> : null}
                <button
                  type="button"
                  className="live-btn live-btn-primary"
                  disabled={!invitePicked.size || inviting}
                  onClick={sendInvites}
                >
                  {inviting ? 'Inviting…' : `Invite${invitePicked.size ? ` (${invitePicked.size})` : ''}`}
                </button>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
