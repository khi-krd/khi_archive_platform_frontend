import { apiClient } from '@/lib/api-client'
import { multipartUploadConfig } from '@/lib/multipart-upload'

// SiteFont — the admin-uploaded site typeface (the same feature the
// khi-dashboard font library drives for the public website). Library rows
// live under /api/site-fonts (admin, site_font:* authorities); the ACTIVE
// font is readable by anyone through /api/guest/site-font, and its bytes are
// proxied at /api/guest/site-fonts/{id}/file — the bucket sends no CORS
// headers, so @font-face must load through the API, never the raw S3 URL.
//
// Wire shape: { id, name, fileUrl, active, createdAt, updatedAt }

// Browsers tag font files with a dozen different MIME types (and often just
// application/octet-stream), so the extension is the real gate.
const ACCEPTED_FONT_EXTENSIONS = ['woff2', 'woff', 'ttf', 'otf']
const ACCEPTED_FONT_ACCEPT = ACCEPTED_FONT_EXTENSIONS.map((e) => `.${e}`).join(',')
const MAX_FONT_BYTES = 20 * 1024 * 1024

function normalizeSiteFont(payload) {
  if (!payload || typeof payload !== 'object') return null

  const fileUrl = payload.fileUrl ?? payload.fileURL ?? payload.url ?? ''
  if (!fileUrl) return null

  return {
    id: payload.id ?? null,
    name: payload.name ?? '',
    fileUrl: String(fileUrl),
    active: Boolean(payload.active),
    createdAt: payload.createdAt ?? null,
    updatedAt: payload.updatedAt ?? payload.createdAt ?? null,
  }
}

function fontExtension(name) {
  const clean = String(name || '').split(/[?#]/)[0]
  const dot = clean.lastIndexOf('.')
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : ''
}

function validateFontFile(file) {
  if (!file) return 'Choose a font file first.'
  const ext = fontExtension(file.name)
  if (!ACCEPTED_FONT_EXTENSIONS.includes(ext)) {
    return 'Unsupported format. Use WOFF2, WOFF, TTF, or OTF.'
  }
  if (file.size > MAX_FONT_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 20 MB.`
  }
  return ''
}

// Absolute URL of the proxied font bytes — used as the @font-face src and
// for admin row previews. `updatedAt` doubles as a cache-buster: the
// endpoint caches hard, so a replaced activation needs a fresh URL.
function siteFontFileUrl(id, updatedAt) {
  const base = apiClient.defaults.baseURL.replace(/\/+$/, '')
  const version = String(updatedAt ?? '').replace(/\D/g, '').slice(0, 14)
  return `${base}/guest/site-fonts/${id}/file${version ? `?v=${version}` : ''}`
}

function fontFormatHint(url) {
  const ext = fontExtension(url)
  const format = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' }[ext]
  return format ? ` format("${format}")` : ''
}

// ── Public reads ──────────────────────────────────────────────────────────

// The font every page should paint with. 404 ("nothing activated") returns
// null; every other failure rethrows so callers can keep a cached record
// instead of flashing the bundled font on a flaky network.
async function fetchActiveSiteFont({ signal } = {}) {
  try {
    const { data } = await apiClient.get('/guest/site-font', { signal })
    return normalizeSiteFont(data)
  } catch (error) {
    if (error?.response?.status === 404) return null
    throw error
  }
}

// ── Admin library management ──────────────────────────────────────────────

async function listSiteFonts({ signal } = {}) {
  const { data } = await apiClient.get('/site-fonts', { signal })
  const rows = Array.isArray(data) ? data : (data?.content ?? [])
  return rows.map(normalizeSiteFont).filter(Boolean)
}

async function uploadSiteFont(file, name, uploadOptions) {
  const formData = new FormData()
  formData.append('file', file)
  if (name) formData.append('name', name)

  const { data } = await apiClient.post('/site-fonts', formData, multipartUploadConfig(uploadOptions))
  return normalizeSiteFont(data)
}

async function activateSiteFont(id) {
  const { data } = await apiClient.post(`/site-fonts/${id}/activate`)
  return normalizeSiteFont(data)
}

async function deactivateSiteFont(id) {
  const { data } = await apiClient.post(`/site-fonts/${id}/deactivate`)
  return normalizeSiteFont(data)
}

async function deleteSiteFont(id) {
  const { data } = await apiClient.delete(`/site-fonts/${id}`)
  return data
}

export {
  ACCEPTED_FONT_ACCEPT,
  ACCEPTED_FONT_EXTENSIONS,
  MAX_FONT_BYTES,
  activateSiteFont,
  deactivateSiteFont,
  deleteSiteFont,
  fetchActiveSiteFont,
  fontFormatHint,
  listSiteFonts,
  normalizeSiteFont,
  siteFontFileUrl,
  uploadSiteFont,
  validateFontFile,
}
