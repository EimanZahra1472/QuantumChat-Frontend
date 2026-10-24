import { Bookmark, FolderOpen, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useFocusTrap from '../hooks/useFocusTrap.js';
import UserAvatar from './UserAvatar.jsx';

export const FOLDER_NAME_MAX = 24;

/**
 * Create or edit a chat folder: name it, then tick the chats that belong in it.
 * `folder` is null for a new folder; `initialKeys` pre-ticks chats (used when
 * a folder is created from a chat's own menu).
 */
export default function ChatFolderModal({
  folder = null,
  conversations = [],
  initialKeys = [],
  onClose,
  onSave,
  onDelete,
}) {
  const isNew = !folder;
  const [name, setName] = useState(folder?.name || '');
  const [selected, setSelected] = useState(
    () => new Set((folder?.conversationKeys || initialKeys).map(String)),
  );
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef(null);

  useFocusTrap(containerRef, true, { onEscape: () => !submitting && onClose?.() });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Chats already in the folder float to the top so editing starts with them.
  const ordered = useMemo(() => {
    const initial = new Set((folder?.conversationKeys || initialKeys).map(String));
    return [...conversations].sort(
      (a, b) => Number(initial.has(String(b.key))) - Number(initial.has(String(a.key))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, folder?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((c) => (c.searchText || c.title || '').toLowerCase().includes(q));
  }, [ordered, search]);

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      setError('Give the folder a name');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onSave({ name: trimmed, conversationKeys: [...selected] });
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not save folder');
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setSubmitting(true);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not delete folder');
      setSubmitting(false);
    }
  }

  const modal = (
    <div className="create-group-overlay" role="presentation" onClick={() => !submitting && onClose?.()}>
      <form
        className="create-group-modal chat-folder-modal"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-folder-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="create-group-modal-header">
          <div className="create-group-modal-icon" aria-hidden="true">
            <FolderOpen size={22} strokeWidth={2} />
          </div>
          <div className="create-group-modal-heading">
            <h2 id="chat-folder-title">{isNew ? 'New folder' : 'Edit folder'}</h2>
            <p>Only you can see your folders.</p>
          </div>
          <button
            type="button"
            className="create-group-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="create-group-body">
          <div className="create-group-field">
            <div className="create-group-label-row">
              <label className="create-group-label" htmlFor="chat-folder-name">
                Folder name
              </label>
              <span className="create-group-count">
                {name.length}/{FOLDER_NAME_MAX}
              </span>
            </div>
            <input
              id="chat-folder-name"
              className="create-group-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Work, Family"
              maxLength={FOLDER_NAME_MAX}
              autoFocus
              disabled={submitting}
            />
          </div>

          <div className="create-group-field create-group-members-block">
            <div className="create-group-label-row">
              <label className="create-group-label" htmlFor="chat-folder-search">
                Chats
              </label>
              <span className="create-group-count">
                {selected.size === 0 ? 'None yet' : `${selected.size} selected`}
              </span>
            </div>
            <input
              id="chat-folder-search"
              className="create-group-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              disabled={submitting}
            />

            <div className="member-picker" role="listbox" aria-label="Chats in this folder" aria-multiselectable="true">
              {filtered.map((c) => {
                const key = String(c.key);
                const checked = selected.has(key);
                return (
                  <label
                    key={key}
                    className={`member-picker-item ${checked ? 'selected' : ''}`}
                    role="option"
                    aria-selected={checked}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(key)}
                      disabled={submitting}
                    />
                    {c.type === 'group' ? (
                      <span className="avatar tiny group-avatar">
                        <Users size={13} strokeWidth={2} aria-hidden="true" />
                      </span>
                    ) : c.isSelfChat ? (
                      <span className="avatar tiny group-avatar">
                        <Bookmark size={13} strokeWidth={2} aria-hidden="true" />
                      </span>
                    ) : (
                      <UserAvatar userId={c.id} name={c.title} hasAvatar={Boolean(c.peer?.hasAvatar)} size="tiny" />
                    )}
                    <span className="member-picker-meta">
                      <span className="member-picker-name">{c.title}</span>
                      <span className="member-picker-email">{c.type === 'group' ? 'Group' : c.isSelfChat ? 'Notes to self' : 'Direct message'}</span>
                    </span>
                    <span className={`member-check ${checked ? 'on' : ''}`} aria-hidden="true">
                      {checked ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : null}
                    </span>
                  </label>
                );
              })}
              {filtered.length === 0 && (
                <p className="empty-hint member-picker-empty">
                  {conversations.length === 0 ? 'No chats yet.' : 'No matching chats'}
                </p>
              )}
            </div>
          </div>

          {error && <div className="auth-error create-group-error">{error}</div>}
        </div>

        <div className="create-group-actions">
          {!isNew && onDelete ? (
            confirmDelete ? (
              <button
                type="button"
                className="confirm-btn danger chat-folder-delete"
                onClick={handleDelete}
                disabled={submitting}
              >
                Delete folder?
              </button>
            ) : (
              <button
                type="button"
                className="confirm-btn cancel chat-folder-delete"
                onClick={() => setConfirmDelete(true)}
                disabled={submitting}
                title="Deletes the folder only. Your chats stay in All."
              >
                Delete
              </button>
            )
          ) : null}
          <button type="button" className="confirm-btn cancel" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="confirm-btn primary" disabled={submitting || !name.trim()}>
            {submitting ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
