import React from 'react'

import {
  KhiBreadcrumb, KhiDetailHead, KhiActions,
} from './KhiDetail'
import { DETAIL } from './khi-data'

// Presentational shell shared by all four media detail pages (audio / video /
// text / image). The page handles fetching + builds the data arrays; this lays
// it out media-first: nav/help row → the file itself → the identity band →
// content cards → metadata ledger → year. No gradient hero container — the
// media is the visual now, so the header stays a clean text band below it.
// The help action renders as the solid-green primary button (same look as the
// catalogue's filter toggle).
export default function KhiMediaDetail({
  title, subtitle, description,
  breadcrumbItems = [], actions = [], tags = [],
  media = null, content = null, meta = null, helpAction = null, footerYear = null,
}) {
  return (
    <>
      <div className="detail-topbar">
        <KhiBreadcrumb items={breadcrumbItems} />
        {helpAction ? (
          <KhiActions actions={[{ ...helpAction, primary: true }]} />
        ) : null}
      </div>

      {media ? <div className="detail-media-lead">{media}</div> : null}

      <KhiDetailHead
        title={title}
        subtitle={subtitle}
        description={description}
        tags={tags}
        action={actions.length ? <KhiActions actions={actions} /> : null}
      />

      {content}
      {/* No section heading — the numbered ledger bands are the headers
          (user: no English anywhere in the details, no extra title block). */}
      {meta ? (
        <section className="detail-meta-section">
          <div className="detail-meta">{meta}</div>
        </section>
      ) : null}
      {footerYear ? (
        <footer className="detail-year-foot">
          <span className="dyf-label">{DETAIL.year}</span>
          <span className="dyf-value">{footerYear}</span>
        </footer>
      ) : null}
    </>
  )
}
