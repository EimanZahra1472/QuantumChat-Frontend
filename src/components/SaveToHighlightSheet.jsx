import { BookmarkPlus, Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { addHighlightItem, listHighlights } from '../api/highlights.js';
import { HIGHLIGHT_CATEGORIES } from '../constants/highlightCategories.js';

function guessMime(story, blob) {
  if (blob?.type && blob.type !== 'application/octet-stream') return blob.type;
  if (story?.mimetype && story.mimetype !== 'application/octet-stream') return story.mimetype;
  if (story?.mediaType === 'video') return 'video/mp4';
  if (story?.mediaType === 'audio') return 'audio/mp4';
  return 'image/jpeg';
}

function guessExt(mime, mediaType) {
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.startsWith('video/') || mediaType === 'video') return '.mp4';
  if (mime.startsWith('audio/') || mediaType === 'audio') return '.m4a';
  return '.jpg';
}

/**
 * Save the currently viewed (decrypted) story media into a profile highlight.
 */
export default function SaveToHighlightSheet({
  open,
  onClose,
  onError,
  onSaved,
  mediaUrl,
  mediaBlob,
  story,
}) {
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setSavingId(null);
    setSavedId(null);
    setError('');
    listHighlights()
      .then((list) => {
        const map = {};
        for (const h of list) map[h.category] = h.itemCount || 0;
        setCounts(map);
      })
      .catch(() => setCounts({}));

    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function resolveBlob() {
    if (mediaBlob instanceof Blob && mediaBlob.size > 0) return mediaBlob;
    if (!mediaUrl) throw new Error('Story media is still loading — wait a moment and try again');
    const res = await fetch(mediaUrl);
    if (!res.ok) throw new Error('Could not read story media');
    const blob = await res.blob();
    if (!blob.size) throw new Error('Story media is empty');
    return blob;
  }

  async function saveTo(categoryId, e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (savingId) return;
    if (!story) {
      setError('Story data missing');
      return;
    }

    setError('');
    setSavingId(categoryId);
    try {
      const blob = await resolveBlob();
      const mime = guessMime(story, blob);
      const ext = guessExt(mime, story.mediaType);
      const file = new File([blob], `highlight-${categoryId}-${Date.now()}${ext}`, { type: mime });

      await addHighlightItem({
        category: categoryId,
        file,
        sourceStoryId: story.id,
        caption: story.caption || '',
        durationMs: story.durationMs || 0,
        mediaType: story.mediaType === 'text' ? 'image' : story.mediaType || 'image',
      });

      setSavedId(categoryId);
      setCounts((prev) => ({ ...prev, [categoryId]: (prev[categoryId] || 0) + 1 }));
      onSaved?.(categoryId);
      setTimeout(() => onClose?.(), 650);
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        err.message ||
        'Could not save to highlight';
      setError(msg);
      onError?.(msg);
    } finally {
      setSavingId(null);
    }
  }

  const canSave = Boolean(mediaBlob || mediaUrl);

  return createPortal(
    <div className="hl-sheet-overlay" onClick={onClose}>
      <div className="hl-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="hl-sheet-handle" aria-hidden />
        <div className="hl-sheet-header">
          <div className="hl-sheet-icon">
            <BookmarkPlus size={20} aria-hidden />
          </div>
          <div>
            <h2>Save to highlight</h2>
            <p>Keep this story on your profile forever</p>
          </div>
        </div>

        {error ? (
          <p className="hl-sheet-error" role="alert">
            {error}
          </p>
        ) : null}

        {!canSave ? (
          <p className="hl-sheet-error" role="status">
            Wait for the story to finish loading, then try again.
          </p>
        ) : null}

        <div className="hl-sheet-grid" role="list">
          {HIGHLIGHT_CATEGORIES.map((cat) => {
            const busy = savingId === cat.id;
            const justSaved = savedId === cat.id;
            const count = counts[cat.id] || 0;
            return (
              <button
                key={cat.id}
                type="button"
                className={`hl-sheet-card${justSaved ? ' saved' : ''}${busy ? ' busy' : ''}`}
                disabled={Boolean(savingId) || !canSave}
                onClick={(e) => saveTo(cat.id, e)}
                role="listitem"
              >
                <span className="hl-sheet-emoji" aria-hidden>
                  {cat.emoji}
                </span>
                <span className="hl-sheet-label">{cat.label}</span>
                <span className="hl-sheet-meta">
                  {busy ? (
                    <>
                      <Loader2 size={14} className="hl-spin" aria-hidden /> Saving…
                    </>
                  ) : justSaved ? (
                    <>
                      <Check size={14} aria-hidden /> Saved
                    </>
                  ) : count > 0 ? (
                    `${count} saved`
                  ) : (
                    'Add'
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <button type="button" className="hl-sheet-cancel" onClick={onClose} disabled={Boolean(savingId)}>
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}
