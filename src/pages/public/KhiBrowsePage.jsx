import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { HighlightProvider } from '@/components/ui/highlight'
import { readFacet, readMediaTypeCount, decodeSelectedFacets } from '@/components/public/public-helpers'
import { guestAudios, guestFacets, guestImages, guestTexts, guestVideos } from '@/services/guest'
import { getStaffBrowsePage, getStaffMediaPage } from '@/services/staff-public-catalog'
import { orderBySharedTag, orderInterleavedByKind } from '@/lib/tag-order'
import { usePublicAccess } from '@/hooks/use-public-access'
import KhiSidebar from '@/components/khi/KhiSidebar'
import KhiToolbar from '@/components/khi/KhiToolbar'
import KhiCard from '@/components/khi/KhiCard'
import { useYearBounds } from '@/components/khi/use-year-bounds'
import { useDataFacets } from '@/components/khi/use-data-facets'
import { usePublicFilterCounts } from '@/components/khi/use-public-filter-counts'
import { IconClose } from '@/components/khi/icons'
import {
  NAV_TYPES,
  TYPE_MAP,
  DEFAULT_TYPE,
  PAGE_SIZE,
  MEDIA_KINDS,
  UI,
  cardFromItem,
  ENTITY_FILTER_KEYS,
  TYPE_PAGE_SIZES,
  publishedYear,
} from '@/components/khi/khi-data'

// Entity scopes reachable via ?type= (the media kinds are reached by selecting
// a single media-type checkbox, which drops into that per-entity scope).
const ENTITY_SCOPES = ['person', 'project', 'category']
const MEDIA_APIS = {
  image: (params) => guestImages.list(params),
  audio: (params) => guestAudios.list(params),
  video: (params) => guestVideos.list(params),
  text: (params) => guestTexts.list(params),
}

// Staff mixed-media pages go through the staff catalog service (it runs the
// same classified/tag ordering client-side) and arrive back as a Spring page.
async function loadStaffMediaSections(params, selectedKinds) {
  const selected = new Set(selectedKinds.length ? selectedKinds : MEDIA_KINDS)
  const kinds = MEDIA_KINDS.filter((kind) => selected.has(kind))
  const page = await getStaffMediaPage(kinds, params)
  return {
    items: page?.content || [],
    totalElements: Number(page?.totalElements) || 0,
    totalPages: Number(page?.totalPages) || 0,
    number: Number(page?.number) || 0,
  }
}

// Bulk size + a hard page cap for the هاوتاگ path — it has to see the WHOLE
// filtered result set to group shared tags, so it pages each selected kind
// through the normal guest endpoints and orders locally.
const TAG_SORT_BULK_SIZE = 500
const TAG_SORT_MAX_PAGES = 10

async function fetchAllMediaRows(kind, params) {
  const api = MEDIA_APIS[kind]
  if (!api) return []
  // Each kind's rows come back already sorted by the server for the normal
  // sorts — only هاوتاگ ('tag') is a client-side ordering the endpoint
  // wouldn't understand, so that's the one key stripped before calling.
  const rest = { ...params }
  delete rest.page
  delete rest.size
  if (rest.sortBy === 'tag') {
    delete rest.sortBy
    delete rest.sortDirection
  }
  const rows = []
  let page = 0
  let totalPages = 1
  do {
    if (params.signal?.aborted) break
    const data = await api({ ...rest, page, size: TAG_SORT_BULK_SIZE })
    const content = data?.content || []
    rows.push(...content)
    const reported = Number(data?.totalPages)
    totalPages = Number.isFinite(reported) && reported >= 0
      ? reported
      : (content.length < TAG_SORT_BULK_SIZE ? page + 1 : page + 2)
    page += 1
  } while (page < totalPages && page < TAG_SORT_MAX_PAGES)
  return rows.map((row) => ({ ...row, kind }))
}

// The mixed "all" grid is classified in repeating 40-item rounds — 10
// images, 10 audio, 10 video, 10 text — and هاوتاگ groups by shared tag.
// Neither order can survive per-type server paging, so the guest path
// gathers each kind's filtered rows once (server-sorted per kind), builds
// the merged order locally, and slices the requested page. The ordered
// list is cached per query+sort so "show more" re-slices without refetching.
const orderedMediaCache = new Map()
const ORDERED_CACHE_MAX = 4

function orderedCacheKey(kinds, params) {
  const rest = { ...params }
  delete rest.signal
  delete rest.page
  delete rest.size
  return `${kinds.join(',')}|${JSON.stringify(rest)}`
}

async function loadOrderedMediaPage(params, selectedKinds) {
  const kinds = MEDIA_KINDS.filter((k) => !selectedKinds.length || selectedKinds.includes(k))
  const size = params.size || 50
  const page = params.page || 0
  const cacheKey = orderedCacheKey(kinds, params)
  let ordered = orderedMediaCache.get(cacheKey)
  if (!ordered) {
    const byKind = {}
    const flat = []
    for (const kind of kinds) {
      const rows = await fetchAllMediaRows(kind, params)
      byKind[kind] = rows
      flat.push(...rows)
    }
    ordered = params.sortBy === 'tag'
      ? orderBySharedTag(flat)
      : orderInterleavedByKind(byKind)
    // A partial list from an aborted fetch must not poison the cache.
    if (!params.signal?.aborted) {
      if (orderedMediaCache.size >= ORDERED_CACHE_MAX) {
        orderedMediaCache.delete(orderedMediaCache.keys().next().value)
      }
      orderedMediaCache.set(cacheKey, ordered)
    }
  }
  return {
    items: ordered.slice(page * size, page * size + size),
    totalElements: ordered.length,
    totalPages: ordered.length ? Math.ceil(ordered.length / size) : 0,
    number: page,
  }
}

// The 'all' scope has no single list endpoint, so the year-slider probe fans
// out to every kind and keeps the global extreme — that way the timeline's
// bounds are the oldest/newest PUBLISHED work in the whole archive, not just
// one kind's. `params` carries sortBy=datePublished + asc|desc, size=1.
async function probeAllMediaBounds(params, staff) {
  const results = await Promise.all(
    MEDIA_KINDS.map((kind) =>
      (staff ? getStaffBrowsePage(kind, params) : MEDIA_APIS[kind](params)).catch(() => null),
    ),
  )
  const items = results.map((res) => res?.content?.[0]).filter(Boolean)
  if (!items.length) return { content: [] }
  const asc = params.sortDirection === 'asc'
  items.sort((a, b) => {
    const ay = publishedYear(a)
    const by = publishedYear(b)
    const av = ay ?? (asc ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER)
    const bv = by ?? (asc ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER)
    return asc ? av - bv : bv - av
  })
  return { content: [items[0]] }
}

// Skeleton placeholder cards shown while a page of results loads — the same
// full-bleed tile as a real card, with two ghost text lines where the title
// and category land.
function SkeletonGrid() {
  return (
    <div className="khi-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card skeleton">
          <div className="media" />
          <div className="card-overlay">
            <div className="sk-line" style={{ width: '70%', height: 16 }} />
            <div className="sk-line" style={{ width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function KhiBrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isStaff, ready: accessReady } = usePublicAccess()
  const resultsRef = useRef(null)
  // Filter rail visibility. Closed by default everywhere — the catalogue leads
  // and the rail opens from the toolbar's filter button (a drawer on phones).
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const q = searchParams.get('q') || ''
  const view = searchParams.get('layout') === 'list' ? 'list' : 'grid'
  const dateFrom = searchParams.get('dateFrom') || ''
  const dateTo = searchParams.get('dateTo') || ''
  // Years are derived only for the compact active-filter chip; the URL keeps
  // backend-native ISO dates (yyyy-mm-dd) so links stay shareable + exact.
  const yearFrom = dateFrom ? Number(dateFrom.slice(0, 4)) || null : null
  const yearTo = dateTo ? Number(dateTo.slice(0, 4)) || null : null

  const selectedMediaTypes = useMemo(
    () => (searchParams.get('types') || '').split(',').filter((k) => MEDIA_KINDS.includes(k)),
    [searchParams],
  )
  // Scope resolution: an explicit ?type= entity (person/project/category) wins.
  // Else selecting exactly ONE media type drops into that media's per-entity
  // scope. 0 or 2+ media kinds stay on the public media grid ('all'), which
  // fans out to /guest/images, /guest/audios, /guest/videos, and /guest/texts.
  const typeParam = searchParams.get('type')
  const isEntityScope = ENTITY_SCOPES.includes(typeParam) && Boolean(TYPE_MAP[typeParam])
  const typeKey = isEntityScope
    ? typeParam
    : (selectedMediaTypes.length === 1 ? selectedMediaTypes[0] : DEFAULT_TYPE)
  const type = TYPE_MAP[typeKey]
  const pageSize = TYPE_PAGE_SIZES[typeKey] || PAGE_SIZE

  // Shared (server) facets + the scope's entity-specific (data-driven) facets,
  // rendered through one FacetGroup list. Data groups key their options by the
  // filter param itself.
  const filterGroups = useMemo(
    () => [
      ...(type.facetMap || []),
      ...(type.dataFacets || []).map((d) => ({ ...d, facetKey: d.paramKey })),
    ],
    [type],
  )

  // Default sort: newest by publishment date — the catalogue's natural
  // landing order with or without a query. هاوتاگ / title are opt-in.
  const defaultSort =
    type.sorts.find((s) => s.dir === 'desc' && ['datePublished', 'createdAt', 'date'].includes(s.key))
    || type.sorts[0]
  // Legacy URLs may still carry the retired keys: date → the new publishment
  // sort; relevance/anything-unknown → the default.
  const rawSortKey = searchParams.get('sortBy')
  const rawSortDir = searchParams.get('sortDirection')
  const normalizedSortKey = rawSortKey === 'date' ? 'datePublished' : rawSortKey
  const sortBy = type.sorts.some((s) => s.key === normalizedSortKey) ? normalizedSortKey : defaultSort.key
  const sortDir = sortBy === normalizedSortKey && rawSortDir ? rawSortDir : defaultSort.dir
  const sortIndex = Math.max(0, type.sorts.findIndex((s) => s.key === sortBy && s.dir === sortDir))

  const selected = useMemo(() => decodeSelectedFacets(searchParams, filterGroups), [searchParams, filterGroups])
  const textFilterValues = useMemo(() => {
    const out = {}
    for (const f of type.textFilters || []) out[f.paramKey] = searchParams.get(f.paramKey) || ''
    return out
  }, [searchParams, type.textFilters])

  const [facets, setFacets] = useState(null)
  const staffTypeApi = useMemo(
    () => (isStaff ? (params) => getStaffBrowsePage(typeKey, params) : null),
    [isStaff, typeKey],
  )
  // Entity-specific checkbox options, tallied from the live archive for the
  // active media scope (empty for the mixed media grid / entity scopes). Merged
  // on top of the server facets so FacetGroup renders both from one object.
  const dataFacets = useDataFacets(type, staffTypeApi)
  const publicFilterCounts = usePublicFilterCounts(typeKey, selectedMediaTypes, isStaff)
  const allFacets = useMemo(
    () => ({ ...(facets || {}), ...(publicFilterCounts.facets || {}), ...dataFacets }),
    [facets, publicFilterCounts.facets, dataFacets],
  )
  // Oldest → newest PUBLISHMENT year span for the date filter bounds,
  // derived from live data. 'all' has no list endpoint, so it probes every
  // kind and keeps the global extreme (see probeAllMediaBounds).
  const allBoundsProbe = useMemo(
    () => (params) => probeAllMediaBounds(params, isStaff),
    [isStaff],
  )
  const yearBounds = useYearBounds(type, facets, typeKey === 'all' ? allBoundsProbe : staffTypeApi)
  // Accumulating result list: a fresh query replaces it; "Show more" appends the
  // next API page. `meta` mirrors the Spring Page envelope (number/totalPages/
  // totalElements). `page` is the highest page index loaded so far.
  const [items, setItems] = useState([])
  const [meta, setMeta] = useState({ totalElements: 0, totalPages: 0, number: 0 })
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)        // first/replacing load → skeleton
  const [loadingMore, setLoadingMore] = useState(false) // appending the next page
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0) // bump to force a refetch (retry button)

  // Debounced "search within" drafts so typing doesn't refetch per keystroke.
  const [textDrafts, setTextDrafts] = useState(textFilterValues)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTextDrafts(textFilterValues) }, [textFilterValues])

  // ── URL helpers ─────────────────────────────────────────────────────────────
  const update = (next, resetPage = true) => {
    const sp = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') sp.delete(k)
      else sp.set(k, v)
    }
    if (resetPage && !('page' in next)) sp.delete('page')
    setSearchParams(sp)
  }

  const switchType = (key) => {
    const sp = new URLSearchParams()
    // 'all' is the default media grid — leave it out of the URL for a clean link.
    if (key && key !== 'all') sp.set('type', key)
    if (q) sp.set('q', q)
    if (view === 'list') sp.set('layout', 'list')
    setSearchParams(sp)
  }

  // On phones the rail is a drawer — close it after a navigation so the user
  // lands back on the results. On desktop it stays put.
  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && !window.matchMedia('(min-width:1025px)').matches) {
      setSidebarOpen(false)
    }
  }

  // ── Facets (once) ─────────────────────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController()
    guestFacets({ signal: ctrl.signal }).then((d) => setFacets(d || null)).catch(() => {})
    return () => ctrl.abort()
  }, [])

  // ── Results ─────────────────────────────────────────────────────────────────
  const selectedKey = JSON.stringify(selected)
  const textKey = JSON.stringify(textFilterValues)
  const mediaKey = selectedMediaTypes.join(',')
  // Identifies the query independent of paging. When it changes we start over at
  // page 0 and REPLACE the list; while it's stable, bumping `page` APPENDS.
  const accessKey = accessReady ? (isStaff ? 'staff' : 'guest') : 'pending'
  const queryKey = `${typeKey}|${q}|${sortBy}|${sortDir}|${dateFrom}|${dateTo}|${selectedKey}|${textKey}|${mediaKey}|${accessKey}|${reload}`

  /* eslint-disable react-hooks/set-state-in-effect */
  // A new query resets paging to 0 (the fetch below then replaces the list).
  useEffect(() => { setPage(0) }, [queryKey])

  const queryKeyRef = useRef('')
  useEffect(() => {
    if (!accessReady) return undefined
    const ctrl = new AbortController()
    // On a query change the page state may still hold a stale value for one
    // render; force page 0 so we never append the wrong page to a fresh list.
    const fresh = queryKeyRef.current !== queryKey
    queryKeyRef.current = queryKey
    const targetPage = fresh ? 0 : page
    const append = targetPage > 0

    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')

    const params = { page: targetPage, size: pageSize, sortBy, sortDirection: sortDir, signal: ctrl.signal }
    if (q) params.q = q
    // The timeline filter is PUBLISHMENT-date semantics: guests hit the
    // publishedFrom/publishedTo params the guest media endpoints expose;
    // staff rows are matched client-side on datePublished (see
    // matchesMediaFilters in the staff catalog service).
    if (type.showDateRange && dateFrom) {
      if (isStaff) params.dateFrom = dateFrom
      else params.publishedFrom = dateFrom
    }
    if (type.showDateRange && dateTo) {
      if (isStaff) params.dateTo = dateTo
      else params.publishedTo = dateTo
    }
    for (const group of filterGroups) {
      const list = selected[group.paramKey]
      if (!Array.isArray(list) || !list.length) continue
      params[group.paramKey] = list
    }
    // The mixed grid is classified in 10-per-kind rounds and هاوتاگ orders
    // by shared tag — neither can survive per-type server paging, so guests
    // gather each kind's filtered rows once and assemble pages locally.
    // Staff rows take the same route inside the staff catalog service.
    const guestLocalOrder =
      !isStaff && (typeKey === 'all' || (sortBy === 'tag' && Boolean(MEDIA_APIS[typeKey])))
    const request = guestLocalOrder
      ? loadOrderedMediaPage(params, typeKey === 'all' ? selectedMediaTypes : [typeKey])
      : typeKey === 'all'
        ? loadStaffMediaSections(params, selectedMediaTypes)
        : (isStaff ? getStaffBrowsePage(typeKey, params) : type.api(params))

    request
      .then((res) => {
        if (ctrl.signal.aborted) return
        const content = typeKey === 'all'
          ? (res?.items || [])
          : (res?.content || (Array.isArray(res) ? res : []))
        setItems((prev) => (append ? [...prev, ...content] : content))
        setMeta({
          totalElements: Number(res?.totalElements ?? content.length),
          totalPages: Number(res?.totalPages ?? (content.length ? 1 : 0)),
          number: Number(res?.number ?? targetPage),
        })
      })
      .catch((err) => { if (err?.code !== 'ERR_CANCELED') setError(UI.loadError) })
      .finally(() => { if (!ctrl.signal.aborted) { setLoading(false); setLoadingMore(false) } })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, page, pageSize, accessReady, isStaff])
  /* eslint-enable react-hooks/set-state-in-effect */

  // On a NEW query (not when appending), reset the scroll so the user
  // starts at the top; "Show more" keeps the scroll position so the list grows.
  useEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0
    window.scrollTo(0, 0)
  }, [queryKey])

  const cards = useMemo(() => items.map((it) => cardFromItem(it, typeKey)), [items, typeKey])
  const totalElements = meta.totalElements
  const hasMore = items.length < totalElements

  // Type-rail counts from global facets.
  const counts = useMemo(() => {
    const apiCounts = publicFilterCounts.counts || {}
    const pick = (primary, fallback) => {
      const first = Number(primary)
      if (Number.isFinite(first)) return first
      const second = Number(fallback)
      return Number.isFinite(second) ? second : undefined
    }
    const c = {}
    c.audio = pick(apiCounts.audio, readMediaTypeCount(facets, 'audio'))
    c.video = pick(apiCounts.video, readMediaTypeCount(facets, 'video'))
    c.text = pick(apiCounts.text, readMediaTypeCount(facets, 'text'))
    c.image = pick(apiCounts.image, readMediaTypeCount(facets, 'image'))
    c.person = pick(apiCounts.person, typeKey === 'person' ? totalElements : undefined)
    c.project = pick(apiCounts.project, typeKey === 'project' ? totalElements : undefined)
    c.category = pick(apiCounts.category, typeKey === 'category' ? totalElements : undefined)
    return c
  }, [facets, publicFilterCounts.counts, typeKey, totalElements])
  const mediaTypeCounts = { audio: counts.audio, video: counts.video, text: counts.text, image: counts.image }

  // ── Facet / filter handlers ─────────────────────────────────────────────────
  // Every public facet behaves as a multi-select checkbox group. Values stay in
  // the URL as comma-separated chips and are sent as repeated query params.
  const onToggleFacet = (paramKey, val) => {
    const cur = new Set(selected[paramKey] || [])
    cur.has(val) ? cur.delete(val) : cur.add(val)
    const arr = [...cur]
    update({ [paramKey]: arr.length ? arr.join(',') : null })
  }
  const onToggleMediaType = (k) => {
    const cur = new Set(selectedMediaTypes)
    cur.has(k) ? cur.delete(k) : cur.add(k)
    const arr = [...cur]
    // Media selection governs the scope. Keep what's universal (q, date range,
    // layout, shared facets); drop the entity ?type=, paging, sort and any
    // scope-specific entity filters — they don't carry across media kinds.
    const sp = new URLSearchParams(searchParams)
    sp.delete('type')
    sp.delete('page')
    sp.delete('sortBy')
    sp.delete('sortDirection')
    for (const key of ENTITY_FILTER_KEYS) sp.delete(key)
    if (arr.length) sp.set('types', arr.join(','))
    else sp.delete('types')
    setSearchParams(sp)
  }
  // Clear every filter but stay in the current scope (entity ?type= or the
  // selected media kinds) and keep the query.
  const clearAll = () => {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (view === 'list') sp.set('layout', 'list')
    if (isEntityScope) sp.set('type', typeKey)
    else if (selectedMediaTypes.length) sp.set('types', selectedMediaTypes.join(','))
    setSearchParams(sp)
  }
  const onTextFilter = (paramKey, value) => {
    setTextDrafts((d) => ({ ...d, [paramKey]: value }))
  }
  // Calendar picker emits backend-native ISO dates (yyyy-mm-dd) directly, so the
  // filter is exact to the day; an empty edge clears that bound.
  const onDateChange = ({ from, to }) => {
    update({ dateFrom: from || null, dateTo: to || null })
  }
  // Commit text drafts to the URL after a pause.
  useEffect(() => {
    const id = setTimeout(() => {
      const patch = {}
      let changed = false
      for (const f of type.textFilters || []) {
        const draft = (textDrafts[f.paramKey] || '').trim()
        const live = (textFilterValues[f.paramKey] || '').trim()
        if (draft !== live) { patch[f.paramKey] = draft || null; changed = true }
      }
      if (changed) update(patch)
    }, 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textDrafts, type.textFilters])

  // ── Active-filter chips ──────────────────────────────────────────────────────
  // Selected values are stored as codes (categoryCode, personCode…); the chip
  // shows the facet's display name so a visitor never sees a technical code.
  const facetLabel = (group, val) => {
    const entry = readFacet(allFacets, group.facetKey || group.paramKey).find((e) => (e.code || e.value) === val)
    return entry?.value || val
  }
  const chips = []
  if (q) chips.push({ key: 'q', label: `«${q}»`, onRemove: () => update({ q: null }) })
  for (const group of filterGroups) {
    for (const val of selected[group.paramKey] || []) {
      chips.push({ key: `${group.paramKey}:${val}`, label: `${group.title}: ${facetLabel(group, val)}`, onRemove: () => onToggleFacet(group.paramKey, val) })
    }
  }
  for (const k of selectedMediaTypes) chips.push({ key: `mt:${k}`, label: ({ audio: 'دەنگ', video: 'ڤیدیۆ', text: 'دەق', image: 'وێنە' })[k], onRemove: () => onToggleMediaType(k) })
  if (type.showDateRange && (dateFrom || dateTo)) chips.push({ key: 'date', label: `${UI.dateRange}: ${yearFrom || '…'}–${yearTo || '…'}`, onRemove: () => update({ dateFrom: null, dateTo: null }) })

  return (
    <HighlightProvider query={q}>
      <div className={`layout${sidebarOpen ? '' : ' side-hidden'}`}>
        {/* Mobile-only dimmer behind the filter drawer. */}
        <div className="scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true" />

        <KhiSidebar
          types={NAV_TYPES}
          activeType={typeKey}
          onType={(k) => { switchType(k === typeKey ? 'all' : k); closeSidebarOnMobile() }}
          onClose={() => setSidebarOpen(false)}
          counts={counts}
          facetGroups={filterGroups}
          facets={allFacets}
          selected={selected}
          onToggleFacet={onToggleFacet}
          showMediaTypes
          mediaKinds={MEDIA_KINDS}
          mediaTypeCounts={mediaTypeCounts}
          selectedMediaTypes={selectedMediaTypes}
          onToggleMediaType={onToggleMediaType}
          showDateRange={type.showDateRange}
          yearMin={yearBounds.min}
          yearMax={yearBounds.max}
          dateFrom={dateFrom}
          dateTo={dateTo}
          yearLoading={!yearBounds.ready}
          onDateChange={onDateChange}
          textFilters={type.textFilters || []}
          textFilterValues={textDrafts}
          onTextFilter={onTextFilter}
        />

        <main className="catalogue-main">
          <KhiToolbar
            view={view}
            onView={(v) => update({ layout: v === 'list' ? 'list' : null }, false)}
            showView={!!q}
            sorts={type.sorts}
            sortIndex={sortIndex}
            onSortChange={(i) => { const s = type.sorts[i]; update({ sortBy: s.key, sortDirection: s.dir }) }}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
            activeCount={chips.length}
          />

          {chips.length ? (
            <div className="active-chips">
              {chips.map((c) => (
                <span key={c.key} className="ac">
                  {c.label}
                  <button className="x" onClick={c.onRemove} aria-label="لابردن"><IconClose width="10" height="10" /></button>
                </span>
              ))}
              <button className="clear-all" onClick={clearAll}>{UI.clearAll}</button>
            </div>
          ) : null}

          {/* The card list scrolls with the page (plain window scroll); the
              show-more control sits just after the loaded cards. */}
          <div className="results-scroll" ref={resultsRef}>
            {loading ? (
              <SkeletonGrid />
            ) : error ? (
              <div className="empty">
                {error}{' '}
                <button className="clear-all" onClick={() => setReload((n) => n + 1)}>{UI.retry}</button>
              </div>
            ) : cards.length ? (
              <>
                <div className={`khi-grid${view === 'list' ? ' list' : ''}`}>
                  {cards.map((c, i) => (
                    <KhiCard key={`${c.kind}:${c.code}:${i}`} record={c} index={i} query={q} />
                  ))}
                </div>

                {hasMore ? (
                  <div className="show-more-wrap">
                    <button
                      type="button"
                      className="show-more-btn"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={loadingMore}
                    >
                      {loadingMore ? UI.loadingMore : UI.showMore}
                      <span className="sm-count">
                        {items.length.toLocaleString()} / {totalElements.toLocaleString()}
                      </span>
                    </button>
                  </div>
                ) : totalElements > pageSize ? (
                  <p className="show-more-done">{`${totalElements.toLocaleString()} ${UI.results}`}</p>
                ) : null}
              </>
            ) : (
              <p className="empty">{UI.empty}</p>
            )}
          </div>
        </main>
      </div>
    </HighlightProvider>
  )
}

export default KhiBrowsePage
