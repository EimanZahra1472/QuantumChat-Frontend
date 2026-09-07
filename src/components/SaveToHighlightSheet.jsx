import { BookmarkPlus, Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { addHighlightItem, listHighlights } from '../api/highlights.js';
import { HIGHLIGHT_CATEGORIES } from '../constants/highlightCategories.js';

/**
 * Save the currently viewed (decrypted) story media into a profile highlight.
 */
export default function SaveToHighlightSheet({
  open,
  onClose,
  onError,
  onSaved,
  mediaUrl,
  story,
}) {
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    if (!open) return undefined;
    setSavingId(null);
    setSavedId(null);
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

  async function saveTo(categoryId) {
    if (!mediaUrl || !story || savingId) return;
    setSavingId(categoryId);
    try {
      const res = await fetch(mediaUrl);
      const blob = await res.blob();
      const ext =
        story.mediaType === 'video'
          ? '.mp4'
          : story.mediaType === 'audio'
            ? '.m4a'
            : '.jpg';
      const file = new File(
        [blob],
        `highlight-${categoryId}-${Date.now()}${ext}`,
        { type: blob.type || story.mimetype || 'application/octet-stream' }
      );
      await addHighlightItem({
        category: categoryId,
        file,
        sourceStoryId: story.id,
        caption: story.caption || '',
        durationMs: story.durationMs || 0,
        mediaType: story.mediaType,
      });
      setSavedId(categoryId);
      setCounts((prev) => ({ ...prev, [categoryId]: (prev[categoryId] || 0) + 1 }));
      onSaved?.(categoryId);
      setTimeout(() => onClose?.(), 700);
    } catch (err) {
      onError?.(err.response?.data?.error || err.message || 'Could not save to highlight');
    } finally {
      setSavingId(null);
    }
  }

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

        <div className="hl-sheet-grid" role="list">
          {HIGHLIGHT_CATEGORIES.map((cat) => {
            const busy = savingId === cat.id;
            const justSaved = savedId === cat.id;
            const count = counts[cat.id] || 0;
            return (
              <button
                key={cat.id}
                type="button"
                className={`hl-sheet-card${justSaved ? ' saved' : ''}`}
                disabled={Boolean(savingId) || !mediaUrl}
                onClick={() => saveTo(cat.id)}
                role="listitem"
              >
                <span className="hl-sheet-emoji" aria-hidden>
                  {cat.emoji}
                </span>
                <span className="hl-sheet-label">{cat.label}</span>
                <span className="hl-sheet-meta">
                  {busy ? (
                    <Loader2 size={14} className="hl-spin" aria-hidden />
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

        <button type="button" className="hl-sheet-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}
