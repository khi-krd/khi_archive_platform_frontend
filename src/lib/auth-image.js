// Global cache for the uploaded auth-panel image, mirroring lib/khi-logo.js.
//
// The image lives in the database instead of the repo, so the sign-in /
// register brand panel reads it from here. The record is mirrored into
// localStorage so a reload paints the right image on the very first frame —
// no flash of the bundled scene while the request is in flight, and a guest
// who saw the image last visit keeps seeing it if the API hiccups.

import { fetchCurrentAuthImage } from '@/services/auth-image'

const STORAGE_KEY = 'khi-auth-image'

let cachedImage = readStoredImage()
let inflight = null
const subscribers = new Set()

function readStoredImage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.imageUrl ? parsed : null
  } catch {
    // Storage may be unavailable in a private browser context.
    return null
  }
}

function writeStoredImage(record) {
  try {
    if (record?.imageUrl) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Non-fatal — the in-memory cache still serves this session.
  }
}

function notify() {
  for (const fn of subscribers) fn(cachedImage)
}

function getActiveAuthImage() {
  return cachedImage
}

function setActiveAuthImage(record) {
  cachedImage = record?.imageUrl ? record : null
  writeStoredImage(cachedImage)
  notify()
  return cachedImage
}

function clearActiveAuthImage() {
  cachedImage = null
  inflight = null
  writeStoredImage(null)
  notify()
}

function subscribeAuthImage(fn) {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

// Fetched once per page load (deduped). A stored record is still refreshed
// in the background so an image replaced by another admin lands on the next
// visit. A real 404 ("no image uploaded") clears the cache; a failed fetch
// must not wipe a good cached record.
function ensureActiveAuthImage() {
  if (!inflight) {
    inflight = fetchCurrentAuthImage()
      .then((record) => {
        if (record) setActiveAuthImage(record)
        else clearActiveAuthImage()
        return cachedImage
      })
      .catch(() => cachedImage)
  }
  return inflight
}

function refreshActiveAuthImage() {
  inflight = null
  return ensureActiveAuthImage()
}

// S3 keeps serving the old bytes for a replaced image when the key is
// reused, so the record's `updatedAt` doubles as a cache-buster.
function resolveAuthImageSrc(record) {
  const url = record?.imageUrl
  if (!url) return null
  if (!record?.updatedAt || url.includes('X-Amz-')) return url

  const version = String(record.updatedAt).replace(/\D/g, '').slice(0, 14)
  if (!version) return url

  return `${url}${url.includes('?') ? '&' : '?'}v=${version}`
}

export {
  clearActiveAuthImage,
  ensureActiveAuthImage,
  getActiveAuthImage,
  refreshActiveAuthImage,
  resolveAuthImageSrc,
  setActiveAuthImage,
  subscribeAuthImage,
}
