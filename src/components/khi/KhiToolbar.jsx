import React, { useEffect, useRef, useState } from 'react'
import { IconGrid, IconList, IconChevron, IconFilter } from './icons'
import { UI } from './khi-data'

// Sort control: a real button (the WHOLE surface opens the menu) plus a listbox
// popover, instead of a native <select> hiding inside a label — that only
// opened from its own narrow text box. Arrow keys move the active option,
// Enter/Space pick it, Escape or a click outside closes.
function SortMenu({ sorts, sortIndex, onSortChange }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(sortIndex)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const listRef = useRef(null)

  const close = () => setOpen(false)
  const choose = (i) => {
    onSortChange(i)
    close()
    buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return undefined
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(sortIndex)
    listRef.current?.focus()
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) close() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, sortIndex])

  const onListKeyDown = (e) => {
    const last = sorts.length - 1
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(last, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(last) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active) }
    else if (e.key === 'Escape' || e.key === 'Tab') { close(); buttonRef.current?.focus() }
  }

  const current = sorts[sortIndex] || sorts[0]

  return (
    <div ref={rootRef} className={`sort-menu${open ? ' open' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className="sort-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true) }
        }}
      >
        <span className="lab">{UI.sort}</span>
        <span className="val">{current?.label}</span>
        <IconChevron />
      </button>
      {open ? (
        <ul
          ref={listRef}
          className="sort-list"
          role="listbox"
          tabIndex={-1}
          aria-label={UI.sort}
          aria-activedescendant={`sort-opt-${active}`}
          onKeyDown={onListKeyDown}
        >
          {sorts.map((s, i) => (
            <li
              key={`${s.key}-${s.dir}`}
              id={`sort-opt-${i}`}
              role="option"
              aria-selected={i === sortIndex}
              className={`${i === sortIndex ? 'on' : ''}${i === active ? ' hot' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

// Results header. The filter toggle and the sort menu travel together as one
// cluster at the start (right) edge of the row: filter first, sort behind it.
// On desktop the cluster glides onto the head of the filter rail while the rail
// is open (see `.rail-controls` in khi-archive.css), so the sort always sits on
// top of the filters. The grid/list toggle keeps the end side.
export default function KhiToolbar({
  view, onView, sorts = [], sortIndex = 0, onSortChange,
  sidebarOpen = false, onToggleSidebar, activeCount = 0, showView = true,
}) {
  return (
    <div className="toolbar">
      <div className="rail-controls">
        {onToggleSidebar ? (
          <button
            type="button"
            className={`filters-toggle icon-only${sidebarOpen ? ' on' : ''}`}
            onClick={onToggleSidebar}
            aria-pressed={sidebarOpen}
            aria-label={UI.filter}
            title={UI.filter}
          >
            <IconFilter />
            {activeCount > 0 ? <span className="cnt">{activeCount}</span> : null}
          </button>
        ) : null}
        {sorts.length ? <SortMenu sorts={sorts} sortIndex={sortIndex} onSortChange={onSortChange} /> : null}
      </div>

      {showView ? (
        <div className="controls">
          <div className="toggle">
            <button className={view === 'grid' ? 'active' : ''} onClick={() => onView('grid')}>
              <IconGrid /> {UI.grid}
            </button>
            <button className={view === 'list' ? 'active' : ''} onClick={() => onView('list')}>
              <IconList /> {UI.list}
            </button>
          </div>
        </div>
      ) : <span />}
    </div>
  )
}
