import React from 'react'
import { Link } from 'react-router-dom'

import { Highlight } from '@/components/ui/highlight'
import KhiMediaPreview from './KhiMediaPreview'
import { IconAll } from './icons'
import { TYPE_LABELS } from './khi-data'

const PREVIEW_LABELED_KINDS = new Set(['audio', 'video', 'text', 'image', 'project'])

// One catalogue card: the cover fills the whole tile and a pine gradient rises
// from its foot carrying the Central-Kurdish name plus one line of context —
// the category, else the person, else the collection. Nothing else: codes,
// dates and descriptions belong to the detail page.
export default function KhiCard({ record, index = 0, query = '' }) {
  const { kind, title, collection, categories = [], person, to } = record

  const subtitle =
    categories.find((c) => c?.label)?.label ||
    person?.name ||
    collection ||
    null

  return (
    <Link
      to={to}
      className={`card rise kind-${kind}`}
      style={{ animationDelay: `${(0.05 + (index % 12) * 0.04).toFixed(2)}s` }}
    >
      <div className="media">
        {!PREVIEW_LABELED_KINDS.has(kind) ? (
          <span className={`type-badge kind-${kind}`}>{TYPE_LABELS[kind] || kind}</span>
        ) : null}
        {record.trending ? (
          <span className="trend-badge">
            <IconAll />
            {record.trendingRank ? `#${record.trendingRank}` : 'Trending'}
          </span>
        ) : null}
        <KhiMediaPreview record={record} />
      </div>

      <div className="card-overlay">
        <h3><Highlight text={title || ''} query={query} /></h3>
        {subtitle ? (
          <span className="card-category">
            <Highlight text={subtitle} query={query} />
          </span>
        ) : null}
      </div>
    </Link>
  )
}
