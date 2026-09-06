import { Clock, FilePen, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import client from '../api/client.js';
import { defaultScheduleLocalValue } from './StoryPublishControls.jsx';

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function StoryDraftsPanel({ open, onClose, onError, onChanged, onPreviewDraft }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [scheduleEditId, setScheduleEditId] = useState(null);
  const [scheduleLocal, setScheduleLocal] = useState(defaultScheduleLocalValue);

  async function load() {
    setLoading(true);
    try {
      const { data } = await client.get('/stories/mine/drafts');
      setItems(data.data || []);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to load drafts');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    load();
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  async function publishNow(id) {
    setBusyId(id);
    try {
      await client.post(`/stories/${id}/publish`);
      await load();
      onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to publish');
    } finally {
      setBusyId(null);
    }
  }

  async function saveSchedule(id) {
    const at = new Date(scheduleLocal);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now() + 30_000) {
      onError?.('Pick a time at least 30 seconds from now');
      return;
    }
    setBusyId(id);
    try {
      await client.patch(`/stories/${id}`, {
        status: 'scheduled',
        publishAt: at.toISOString(),
      });
      setScheduleEditId(null);
      await load();
      onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to update schedule');
    } finally {
      setBusyId(null);
    }
  }

  async function convertToDraft(id) {
    setBusyId(id);
    try {
      await client.patch(`/stories/${id}`, { status: 'draft' });
      await load();
      onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to update draft');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id) {
    setBusyId(id);
    try {
      await client.delete(`/stories/${id}`);
      await load();
      onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to delete');
    } finally {
      setBusyId(null);
    }
  }

  return createPortal(
    <div className="status-create-overlay" onClick={onClose}>
      <div className="story-drafts-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="status-create-handle" aria-hidden />
        <div className="story-drafts-header">
          <h2 className="status-create-title">Drafts &amp; scheduled</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="status-create-subtitle">Edit, preview, schedule, or publish when ready</p>

        {loading && <p className="empty-hint">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="empty-hint">No drafts or scheduled statuses yet.</p>
        )}

        <ul className="story-drafts-list">
          {items.map((item) => {
            const busy = busyId === item.id;
            return (
              <li key={item.id} className="story-drafts-row">
                <div className="story-drafts-meta">
                  <span className={`story-drafts-badge ${item.status}`}>
                    {item.status === 'scheduled' ? 'Scheduled' : 'Draft'}
                  </span>
                  <strong>{item.mediaType || 'media'}</strong>
                  <span className="story-drafts-when">
                    {item.status === 'scheduled'
                      ? `Goes live ${formatWhen(item.publishAt)}`
                      : `Saved ${formatWhen(item.updatedAt || item.createdAt)}`}
                  </span>
                </div>

                {scheduleEditId === item.id && (
                  <div className="story-drafts-schedule-edit">
                    <input
                      type="datetime-local"
                      className="story-schedule-input"
                      value={scheduleLocal}
                      disabled={busy}
                      onChange={(e) => setScheduleLocal(e.target.value)}
                    />
                    <button type="button" className="story-composer-post" disabled={busy} onClick={() => saveSchedule(item.id)}>
                      Save time
                    </button>
                  </div>
                )}

                <div className="story-drafts-actions">
                  <button
                    type="button"
                    title="Preview"
                    disabled={busy}
                    onClick={() => onPreviewDraft?.(item)}
                  >
                    <FilePen size={16} aria-hidden />
                    Preview
                  </button>
                  <button type="button" title="Publish now" disabled={busy} onClick={() => publishNow(item.id)}>
                    <Upload size={16} aria-hidden />
                    Publish
                  </button>
                  <button
                    type="button"
                    title="Schedule"
                    disabled={busy}
                    onClick={() => {
                      setScheduleEditId(item.id);
                      setScheduleLocal(
                        item.publishAt
                          ? defaultScheduleLocalValueFromIso(item.publishAt)
                          : defaultScheduleLocalValue()
                      );
                    }}
                  >
                    <Clock size={16} aria-hidden />
                    Schedule
                  </button>
                  {item.status === 'scheduled' && (
                    <button type="button" disabled={busy} onClick={() => convertToDraft(item.id)}>
                      Unschedule
                    </button>
                  )}
                  <button type="button" className="danger" disabled={busy} onClick={() => remove(item.id)}>
                    <Trash2 size={16} aria-hidden />
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body
  );
}

function defaultScheduleLocalValueFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return defaultScheduleLocalValue();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
