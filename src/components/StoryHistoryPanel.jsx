import { BookmarkPlus, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import client from '../api/client.js';
import StoryDraftsPanel from './StoryDraftsPanel.jsx';
import HighlightPickerSheet from './HighlightPickerSheet.jsx';

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

function ActiveTab({ currentUserId, onError, onOpenHighlight, onPreviewStory }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { data } = await client.get('/stories');
      const mine = (data.data || [])
        .filter((s) => String(s.user?.id || s.user) === String(currentUserId))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      setItems(mine);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to load active stories');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <p className="empty-hint">Loading…</p>;
  if (!items.length) return <p className="empty-hint">No live stories right now — post one and it'll show up here.</p>;

  return (
    <ul className="story-drafts-list">
      {items.map((item, i) => (
        <li key={item.id} className="story-drafts-row">
          <div className="story-drafts-meta">
            <span className="story-drafts-badge">Live</span>
            <strong>{item.mediaType || 'media'}</strong>
            <span className="story-drafts-when">Posted {formatWhen(item.createdAt)}</span>
          </div>
          <div className="story-drafts-actions">
            <button type="button" onClick={() => onPreviewStory(items, i)}>
              <Play size={16} aria-hidden />
              View
            </button>
            <button type="button" onClick={() => onOpenHighlight(item)}>
              <BookmarkPlus size={16} aria-hidden />
              Save to highlight
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ArchiveTab({ onError, onChanged, onOpenHighlight }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await client.get('/stories/mine/archive');
      setItems(data.data || []);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to load archive');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reshare(id) {
    setBusyId(id);
    try {
      await client.post(`/stories/${id}/reshare`);
      setItems((prev) => prev.filter((i) => i.id !== id));
      onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to reshare');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id) {
    setBusyId(id);
    try {
      await client.delete(`/stories/${id}`);
      setItems((prev) => prev.filter((i) => i.id !== id));
      onChanged?.();
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Failed to delete');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="empty-hint">Loading…</p>;
  if (!items.length) return <p className="empty-hint">No expired stories yet — anything that expires stays here.</p>;

  return (
    <ul className="story-drafts-list">
      {items.map((item) => {
        const busy = busyId === item.id;
        return (
          <li key={item.id} className="story-drafts-row">
            <div className="story-drafts-meta">
              <span className="story-drafts-badge draft">Expired</span>
              <strong>{item.mediaType || 'media'}</strong>
              <span className="story-drafts-when">Expired {formatWhen(item.expiresAt)}</span>
            </div>
            <div className="story-drafts-actions">
              <button type="button" disabled={busy} onClick={() => onOpenHighlight(item)}>
                <BookmarkPlus size={16} aria-hidden />
                Save to highlight
              </button>
              <button type="button" className="story-drafts-publish" disabled={busy} onClick={() => reshare(item.id)}>
                <RotateCcw size={16} aria-hidden />
                {busy ? 'Resharing…' : 'Reshare'}
              </button>
              <button type="button" className="danger" disabled={busy} onClick={() => remove(item.id)}>
                <Trash2 size={16} aria-hidden />
                Delete
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function StoryHistoryPanel({
  open,
  onClose,
  onError,
  onChanged,
  currentUserId,
  initialTab = 'active',
  onPreviewDraft,
  onPreviewStory,
}) {
  const [tab, setTab] = useState(initialTab);
  const [highlightTarget, setHighlightTarget] = useState(null);

  useEffect(() => {
    if (open) setTab(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);

  if (!open) return null;

  // Drafts tab reuses the existing StoryDraftsPanel wholesale — same open/close contract.
  if (tab === 'drafts') {
    return (
      <StoryDraftsPanel
        open
        onClose={() => setTab('active')}
        onError={onError}
        onChanged={onChanged}
        onPreviewDraft={onPreviewDraft}
      />
    );
  }

  return createPortal(
    <div className="story-drafts-overlay" onClick={onClose}>
      <div className="story-drafts-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="story-drafts-header">
          <h2 className="status-create-title">Story history</h2>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="settings-tabs" style={{ padding: '0 0 12px', margin: '0 0 8px' }}>
          {['active', 'archive', 'drafts'].map((t) => (
            <button
              key={t}
              type="button"
              className={`settings-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              <span className="settings-tab-label">
                {t === 'active' ? 'Active' : t === 'archive' ? 'Archive' : 'Drafts'}
              </span>
            </button>
          ))}
        </div>

        {tab === 'active' && (
          <ActiveTab
            currentUserId={currentUserId}
            onError={onError}
            onOpenHighlight={(story) => setHighlightTarget(story)}
            onPreviewStory={(items, index) => {
              onClose?.();
              onPreviewStory?.(items, index);
            }}
          />
        )}

        {tab === 'archive' && (
          <ArchiveTab
            onError={onError}
            onChanged={onChanged}
            onOpenHighlight={(story) => setHighlightTarget(story)}
          />
        )}
      </div>

      {highlightTarget && (
        <HighlightPickerSheet
          open
          onClose={() => setHighlightTarget(null)}
          onError={onError}
          onSaved={() => setHighlightTarget(null)}
          mediaUrl={`/api/stories/${highlightTarget.id}/media`}
          story={highlightTarget}
        />
      )}
    </div>,
    document.body
  );
}