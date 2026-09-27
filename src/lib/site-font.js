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
    document.documentElement.classList.remove('khi-site-font-on')
    return
  }

  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }

  renderFontStyle(style, record)
  document.documentElement.classList.add('khi-site-font-on')
  normalizeSiteFontSize(record, style)
}

// ── Optical size normalization ────────────────────────────────────────────
// Uploaded faces ship arbitrary em metrics — the same 15px spec renders
// visibly bigger or smaller than the Vazirmatn it replaces (the navbar text
// grows/shrinks). Measure both faces' x-height once, bake a size-adjust into
// the @font-face, and persist it on the record so the index.html boot script
// bakes it in before first paint too. No font-size rule anywhere changes.
const MEASURE_PX = 100
const REFERENCE_STACK = '"Vazirmatn","Amiri",ui-sans-serif,system-ui,sans-serif'
let measureCtx

function measureXHeight(familyStack) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  measureCtx.font = `${MEASURE_PX}px ${familyStack}`
  return measureCtx.measureText('x').actualBoundingBoxAscent || 0
}

function renderFontStyle(style, record) {
  const src = `url("${record.resolvedFileUrl}")${fontFormatHint(record.resolvedFileUrl)}`
  const sizeAdjust = record.sizeAdjust ? `;size-adjust:${record.sizeAdjust}%` : ''
  // While a site font is active it is THE typeface everywhere — the public
  // catalogue hardcodes 'Amiri'/'Vazirmatn' stacks that bypass --font-sans,
  // so the cascade below wins them all. True code/mono contexts keep their
  // typeface so record codes and counters stay legible.
  style.textContent =
    `@font-face{font-family:"KHI Site Font";src:${src};font-weight:100 900;font-style:normal;font-display:swap${sizeAdjust}}` +
    `\nhtml.khi-site-font-on body,html.khi-site-font-on body :not(code):not(kbd):not(pre):not(samp):not(.font-mono){font-family:"KHI Site Font",${REFERENCE_STACK} !important}`
}

async function normalizeSiteFontSize(record, style) {
  if (record.sizeAdjust) return // persisted from an earlier visit — already baked
  try {
    await Promise.race([
      document.fonts.load(`${MEASURE_PX}px "KHI Site Font"`),
      new Promise((_, reject) => setTimeout(reject, 4000)),
    ])
    await document.fonts.load(`${MEASURE_PX}px Vazirmatn`).catch(() => {})
    const siteX = measureXHeight('"KHI Site Font"')
    const refX = measureXHeight(REFERENCE_STACK)
    if (!siteX || !refX) return
    const adj = Math.round((refX / siteX) * 100)
    if (adj < 55 || adj > 175) return // implausible metrics — leave untouched
    record.sizeAdjust = adj
    writeStoredFont(record)
    if (record === cachedFont && style.isConnected) renderFontStyle(style, record)
  } catch {
    // Font never finished loading — keep the unadjusted face.
  }
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
