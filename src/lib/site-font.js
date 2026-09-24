// Global cache for the admin-uploaded site typeface, mirroring
// lib/khi-logo.js / lib/auth-image.js.
//
// Admin → Settings → Site font uploads a font file; the active row is what
// every page paints with. The record is mirrored into localStorage (with the
// resolved proxy URL baked in) so the inline boot script in index.html can
// inject the @font-face before first paint — no flash of the bundled font.
//
// How the font wins: `resolveAppearance` prepends SITE_FONT_FAMILY to the
// DEFAULT font stack, so the uploaded face is the app font unless a user
// explicitly picked another family in the appearance tweaker (that picker
// only exists on staff workspaces anyway).

import { fetchActiveSiteFont, fontFormatHint, siteFontFileUrl } from '@/services/site-font'

const STORAGE_KEY = 'khi-site-font'
const STYLE_ID = 'khi-site-font-face'
const SITE_FONT_FAMILY = '"KHI Site Font"'

let cachedFont = readStoredFont()
let inflight = null
const subscribers = new Set()

function readStoredFont() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.resolvedFileUrl ? parsed : null
  } catch {
    return null
  }
}

function writeStoredFont(record) {
  try {
    if (record?.resolvedFileUrl) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Non-fatal — the in-memory cache still serves this session.
  }
}

function notify() {
  for (const fn of subscribers) fn(cachedFont)
}

// Injects (or removes) the single @font-face rule the family name resolves
// to. Called whenever the active record changes, and once at boot from the
// cached record so the face is registered before React paints.
function applySiteFontFace(record) {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID)

  if (!record?.resolvedFileUrl) {
    style?.remove()
    return
  }

  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }

  const src = `url("${record.resolvedFileUrl}")${fontFormatHint(record.resolvedFileUrl)}`
  style.textContent =
    `@font-face{font-family:"KHI Site Font";src:${src};font-weight:100 900;font-style:normal;font-display:swap}`
}

function getActiveSiteFont() {
  return cachedFont
}

// Wraps a base CSS font stack with the uploaded face when one is active —
// the appearance resolver calls this on the DEFAULT stack only.
function withSiteFont(baseStack) {
  return cachedFont?.resolvedFileUrl ? `${SITE_FONT_FAMILY}, ${baseStack}` : baseStack
}

function setActiveSiteFont(record) {
  cachedFont = record?.fileUrl
    ? { ...record, resolvedFileUrl: siteFontFileUrl(record.id, record.updatedAt) }
    : null
  writeStoredFont(cachedFont)
  applySiteFontFace(cachedFont)
  notify()
  return cachedFont
}

function clearActiveSiteFont() {
  cachedFont = null
  inflight = null
  writeStoredFont(null)
  applySiteFontFace(null)
  notify()
}

function subscribeSiteFont(fn) {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

// Fetched once per page load (deduped). A real 404 ("no active font") clears
// the cache; a network blip keeps it so the font doesn't flash off.
function ensureActiveSiteFont() {
  if (!inflight) {
    inflight = fetchActiveSiteFont()
      .then((record) => {
        if (record) setActiveSiteFont(record)
        else clearActiveSiteFont()
        return cachedFont
      })
      .catch(() => cachedFont)
  }
  return inflight
}

function refreshActiveSiteFont() {
  inflight = null
  return ensureActiveSiteFont()
}

// Boot-time hook for main.jsx: register the cached face immediately (the
// inline script in index.html already did this for the very first paint),
// then refresh from the API in the background.
function bootSiteFont() {
  applySiteFontFace(cachedFont)
  ensureActiveSiteFont().catch(() => {})
}

export {
  SITE_FONT_FAMILY,
  applySiteFontFace,
  bootSiteFont,
  clearActiveSiteFont,
  ensureActiveSiteFont,
  getActiveSiteFont,
  refreshActiveSiteFont,
  setActiveSiteFont,
  subscribeSiteFont,
  withSiteFont,
}
