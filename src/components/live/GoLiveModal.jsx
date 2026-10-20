import { useEffect, useMemo, useState } from 'react';
import { Lock, Radio, Users, UserCheck, X } from 'lucide-react';
import ToggleSwitch from '../ToggleSwitch.jsx';
import LivePeoplePicker from './LivePeoplePicker.jsx';
import '../../styles/liveStream.css';

const TITLE_MAX = 100;

const AUDIENCES = [
  { id: 'friends', label: 'Friends', hint: 'All your friends can watch', Icon: Users },
  { id: 'group', label: 'A group', hint: 'Members of one group', Icon: Users },
  { id: 'custom', label: 'Selected friends', hint: 'Only the people you pick', Icon: UserCheck },
];

/**
 * Pre-stream setup: title, audience (privacy) and local recording.
 * `onStart` resolves once the stream is live, or rejects with the server error.
 */
export default function GoLiveModal({ friends = [], groups = [], defaultGroupId = '', onClose, onStart }) {
  const [title, setTitle] = useState('');
  const [audienceType, setAudienceType] = useState(defaultGroupId ? 'group' : 'friends');
  const [groupId, setGroupId] = useState(defaultGroupId || '');
  const [picked, setPicked] = useState(() => new Set());
  const [hidden, setHidden] = useState(() => new Set());
  const [showHideFrom, setShowHideFrom] = useState(false);
  const [record, setRecord] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const privateGroups = useMemo(() => groups.filter((g) => g?.id), [groups]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && !submitting) onClose?.();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, submitting]);

  function toggleIn(setter) {
    return (id) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
  }

  const canStart =
    !submitting &&
    (audienceType === 'friends' ||
      (audienceType === 'group' && groupId) ||
      (audienceType === 'custom' && picked.size > 0));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canStart) return;
    setSubmitting(true);
    setError('');
    const audience = { type: audienceType };
    if (audienceType === 'group') audience.groupId = groupId;
    if (audienceType === 'custom') audience.userIds = [...picked];
    if (audienceType !== 'custom' && hidden.size) audience.hiddenFrom = [...hidden];
    try {
      await onStart({ title: title.trim(), audience, record });
    } catch (err) {
      const status = err?.response?.status;
      setError(
        err?.response?.data?.error ||
          (err?.name === 'NotAllowedError'
            ? 'Camera and microphone access is needed to go live.'
            : status
              ? 'Could not start your live video.'
              : err?.message || 'Could not start your live video.')
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="live-modal-backdrop" onClick={() => !submitting && onClose?.()}>
      <form
        className="live-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="go-live-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header className="live-modal-header">
          <h2 id="go-live-title">
            <Radio size={18} aria-hidden="true" /> Go live
          </h2>
          <button type="button" className="live-icon-btn" onClick={onClose} disabled={submitting} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="live-modal-body">
          <label className="live-field">
            <span className="live-label">Title (optional)</span>
            <input
              className="live-input"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's happening?"
              disabled={submitting}
              autoFocus
            />
            <small className="live-hint">
              {title.length}/{TITLE_MAX} · The title is visible to QuantumChat&apos;s servers.
            </small>
          </label>

          <fieldset className="live-field" disabled={submitting}>
            <legend className="live-label">Who can watch</legend>
            <div className="live-audience-options" role="radiogroup">
              {AUDIENCES.map(({ id, label, hint, Icon }) => (
                <label key={id} className={`live-audience-option${audienceType === id ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="live-audience"
                    value={id}
                    checked={audienceType === id}
                    onChange={() => setAudienceType(id)}
                    disabled={id === 'group' && privateGroups.length === 0}
                  />
                  <Icon size={16} aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>{id === 'group' && privateGroups.length === 0 ? 'You are not in any groups' : hint}</small>
                  </span>
                </label>
              ))}
            </div>

            {audienceType === 'group' ? (
              <select
                className="live-input"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                aria-label="Group"
              >
                <option value="">Choose a group…</option>
                {privateGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            ) : null}

            {audienceType === 'custom' ? (
              <LivePeoplePicker
                people={friends}
                selected={picked}
                onToggle={toggleIn(setPicked)}
                ariaLabel="Viewers"
                emptyText="Add friends to pick a custom audience"
              />
            ) : null}

            {audienceType === 'friends' && friends.length > 0 ? (
              <div className="live-hide-from">
                <button type="button" className="live-link-btn" onClick={() => setShowHideFrom((v) => !v)}>
                  <Lock size={14} aria-hidden="true" />
                  {hidden.size ? `Hidden from ${hidden.size}` : 'Hide from specific friends'}
                </button>
                {showHideFrom ? (
                  <LivePeoplePicker
                    people={friends}
                    selected={hidden}
                    onToggle={toggleIn(setHidden)}
                    ariaLabel="Hide from"
                  />
                ) : null}
              </div>
            ) : null}
          </fieldset>

          <div className="live-field live-record-row">
            <span>
              <strong>Record on this device</strong>
              <small className="live-hint">When you end, choose to save the video or discard it. It is never uploaded.</small>
            </span>
            <ToggleSwitch checked={record} onChange={setRecord} disabled={submitting} ariaLabel="Record live video" />
          </div>

          <p className="live-hint live-e2e-note">
            Video, comments and reactions go directly between devices, end-to-end encrypted. Your audience will be
            notified when you go live.
          </p>

          {error ? (
            <p className="live-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="live-modal-footer">
          <button type="button" className="live-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="live-btn live-btn-primary" disabled={!canStart}>
            <Radio size={16} aria-hidden="true" />
            {submitting ? 'Starting…' : 'Go live'}
          </button>
        </footer>
      </form>
    </div>
  );
}
