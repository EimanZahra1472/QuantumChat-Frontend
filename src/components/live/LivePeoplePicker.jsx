import { useMemo, useState } from 'react';
import UserAvatar from '../UserAvatar.jsx';

function labelOf(person) {
  return person.displayName || person.username || 'Friend';
}

/** Searchable multi-select list used by the go-live audience picker and mid-stream invites. */
export default function LivePeoplePicker({
  people = [],
  selected,
  onToggle,
  disabledIds,
  disabledHint = '',
  emptyText = 'No friends to show',
  ariaLabel = 'People',
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.displayName, p.username].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [people, query]);

  return (
    <div className="live-picker">
      <input
        className="live-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search friends…"
        aria-label={`Search ${ariaLabel.toLowerCase()}`}
      />
      <div className="live-picker-list" role="listbox" aria-label={ariaLabel} aria-multiselectable="true">
        {filtered.length === 0 ? <p className="live-picker-empty">{emptyText}</p> : null}
        {filtered.map((p) => {
          const id = String(p.id || p._id);
          const checked = selected.has(id);
          const disabled = Boolean(disabledIds?.has(id));
          return (
            <label
              key={id}
              className={`live-picker-item${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
              role="option"
              aria-selected={checked}
              aria-disabled={disabled}
            >
              <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(id)} />
              <UserAvatar userId={id} name={labelOf(p)} hasAvatar={p.hasAvatar} size="sm" />
              <span className="live-picker-name">{labelOf(p)}</span>
              {disabled && disabledHint ? <span className="live-picker-hint">{disabledHint}</span> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
